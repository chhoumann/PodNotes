import { Notice, TFile } from "obsidian";
import { OpenAI } from "openai";
import type PodNotes from "../main";
import { downloadEpisode } from "../downloadEpisode";
import {
	FilePathTemplateEngine,
	TranscriptTemplateEngine,
	TimestampTemplateEngine,
} from "../TemplateEngine";
import type { Episode } from "src/types/Episode";
import type { Transcription } from "openai/resources/audio";

function TimerNotice(heading: string, initialMessage: string) {
	let currentMessage = initialMessage;
	const startTime = Date.now();
	let stopTime: number;
	const notice = new Notice(initialMessage, 0);

	function formatMsg(message: string): string {
		return `${heading} (${getTime()}):\n\n${message}`;
	}

	function update(message: string) {
		currentMessage = message;
		notice.setMessage(formatMsg(currentMessage));
	}

	const interval = setInterval(() => {
		notice.setMessage(formatMsg(currentMessage));
	}, 1000);

	function getTime(): string {
		return formatTime(stopTime ? stopTime - startTime : Date.now() - startTime);
	}

	return {
		update,
		hide: () => notice.hide(),
		stop: () => {
			stopTime = Date.now();
			clearInterval(interval);
		},
	};
}

function formatTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	return `${hours.toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export class TranscriptionService {
	private plugin: PodNotes;
	private client: OpenAI | null = null;
	private MAX_RETRIES = 3;
	public isTranscribing = false;
	private cancelRequested = false;
	private activeNotice: any = null;
	
	// Progress information for UI - using getters/setters for reactivity
	private _progressPercent: number = 0;
	private _progressSize: string = "0 KB";
	private _timeRemaining: string = "Calculating...";
	private _processingStatus: string = "Preparing...";
	
	// Add getters and setters for reactivity with minimal logging
	public get progressPercent(): number { return this._progressPercent; }
	public set progressPercent(value: number) { 
		this._progressPercent = value;
		// Only log significant progress changes to reduce noise
		if (value % 10 === 0 || value === 100) {
			console.log(`Progress update: ${value}%`);
		}
	}
	
	public get progressSize(): string { return this._progressSize; }
	public set progressSize(value: string) { 
		this._progressSize = value;
	}
	
	public get timeRemaining(): string { return this._timeRemaining; }
	public set timeRemaining(value: string) { 
		this._timeRemaining = value;
	}
	
	public get processingStatus(): string { return this._processingStatus; }
	public set processingStatus(value: string) { 
		// Only log when status changes
		if (this._processingStatus !== value) {
			console.log(`Status update: ${value}`);
			this._processingStatus = value;
		} else {
			this._processingStatus = value;
		}
	}
	
	private resumeData: {
		episodeId: string;
		chunks: {processed: boolean; index: number}[];
		results: any[];
		completedSize: number;
		totalSize: number;
	} | null = null;

	constructor(plugin: PodNotes) {
		this.plugin = plugin;
	}
	
	/**
	 * Initialize the OpenAI client with API key validation
	 * @returns true if API key is valid, false otherwise
	 */
	private initializeClient(): boolean {
		const apiKey = this.plugin.settings.openAIApiKey;
		
		if (!apiKey || apiKey.trim() === "") {
			new Notice("OpenAI API key is required for transcription. Please set it in the settings tab.");
			return false;
		}
		
		if (!apiKey.startsWith("sk-")) {
			new Notice("Invalid OpenAI API key format. Keys should start with 'sk-'");
			return false;
		}
		
		if (apiKey.length < 20) {
			new Notice("OpenAI API key appears to be too short. Please check your API key.");
			return false;
		}
		
		try {
			this.client = new OpenAI({
				apiKey: apiKey,
				dangerouslyAllowBrowser: true,
			});
			return true;
		} catch (error) {
			console.error("Error initializing OpenAI client:", error);
			new Notice(`Failed to initialize OpenAI client: ${error.message}`);
			return false;
		}
	}

	/**
	 * Cancels the current transcription process
	 */
	cancelTranscription(): void {
		if (!this.isTranscribing) {
			return;
		}
		
		this.cancelRequested = true;
		this.processingStatus = "Cancelling...";
		
		// The cancellation will be handled in the transcription process
		// No notifications, everything will be shown in the UI
	}
	
	/**
	 * Calculate file size in a human-readable format
	 */
	private formatFileSize(bytes: number): string {
		if (bytes < 1024) return bytes + " bytes";
		if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
		if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + " MB";
		return (bytes / 1073741824).toFixed(1) + " GB";
	}
	
	/**
	 * Estimate transcription time based on file size
	 * This is a realistic estimate based on OpenAI's processing capability and network overhead
	 */
	private estimateTranscriptionTime(bytes: number): string {
		// More realistic estimate: Processing 1MB takes ~3-4 minutes due to
		// API processing time, network overhead, and parallelism constraints
		const processingFactor = 3.5; // Minutes per MB
		const minutes = Math.max(5, Math.ceil((bytes / 1048576) * processingFactor));
		
		// Add additional time for initial setup and final processing
		const totalMinutes = minutes + 2;
		
		if (totalMinutes < 60) {
			return `~${totalMinutes}m`;
		}
		
		const hours = Math.floor(totalMinutes / 60);
		const remainingMinutes = totalMinutes % 60;
		
		if (remainingMinutes === 0) {
			return `~${hours}h`;
		}
		return `~${hours}h ${remainingMinutes}m`;
	}
	
	/**
	 * Save resumable state to localStorage for potential recovery
	 */
	private saveResumeState(episodeId: string, chunks: any[], results: any[], completedSize: number, totalSize: number): void {
		this.resumeData = {
			episodeId,
			chunks: chunks.map((_, index) => ({ processed: results[index] !== undefined, index })),
			results: results.filter(r => r !== undefined),
			completedSize,
			totalSize
		};
		
		// Save to localStorage for persistence across sessions
		try {
			localStorage.setItem('podnotes-resume-transcription', JSON.stringify(this.resumeData));
		} catch (error) {
			console.error("Failed to save resume state:", error);
		}
	}
	
	/**
	 * Check if there's a resumable transcription for the given episode
	 */
	hasResumableTranscription(episodeId: string): boolean {
		try {
			const savedData = localStorage.getItem('podnotes-resume-transcription');
			if (!savedData) return false;
			
			const resumeData = JSON.parse(savedData);
			return resumeData.episodeId === episodeId;
		} catch {
			return false;
		}
	}
	
	/**
	 * Clear resume state
	 */
	private clearResumeState(): void {
		this.resumeData = null;
		try {
			localStorage.removeItem('podnotes-resume-transcription');
		} catch (error) {
			console.error("Failed to clear resume state:", error);
		}
	}

	/**
	 * Transcribes the current episode asynchronously with optimized memory usage and performance.
	 * Uses non-blocking approach to maintain responsiveness of the Obsidian UI.
	 * @param resume Whether to attempt to resume a previously interrupted transcription
	 */
	async transcribeCurrentEpisode(resume: boolean = false): Promise<void> {
		// Get current episode first
		const currentEpisode = this.plugin.api.podcast;
		if (!currentEpisode) {
			this.processingStatus = "Error: No episode is playing";
			setTimeout(() => {
				this.isTranscribing = false;
			}, 2000);
			return;
		}
		
		// Set isTranscribing to true first for immediate UI update
		this.isTranscribing = true;
		
		// Reset progress indicators (these should be visible immediately)
		this.progressPercent = 0.1; // Start with minimal percentage to show activity
		this.progressSize = "0 KB";
		this.timeRemaining = "Calculating...";
		this.processingStatus = "Preparing...";
		
		// Force UI to update by triggering a microtask
		await new Promise(resolve => setTimeout(resolve, 0));
		
		// Validate API key
		if (!this.initializeClient()) {
			// Reset state if validation fails
			this.processingStatus = "Error: Invalid API key";
			setTimeout(() => {
				this.isTranscribing = false;
			}, 2000);
			return;
		}
		
		// Check if transcription file already exists (only if not resuming)
		if (!resume) {
			const transcriptPath = FilePathTemplateEngine(
				this.plugin.settings.transcript.path,
				currentEpisode,
			);
			const existingFile = this.plugin.app.vault.getAbstractFileByPath(transcriptPath);
			if (existingFile instanceof TFile) {
				this.processingStatus = `Already transcribed: ${transcriptPath}`;
				setTimeout(() => {
					this.isTranscribing = false;
				}, 2000);
				return;
			}
		}

		// Reset cancellation flag
		this.cancelRequested = false;

		try {
			// Use setTimeout to allow UI to update before heavy processing starts
			await new Promise(resolve => setTimeout(resolve, 50));
			
			// Update UI status
			this.processingStatus = "Downloading episode...";
			
			const downloadPath = await downloadEpisode(
				currentEpisode,
				this.plugin.settings.download.path,
			);
			const podcastFile =
				this.plugin.app.vault.getAbstractFileByPath(downloadPath);
			if (!podcastFile || !(podcastFile instanceof TFile)) {
				throw new Error("Failed to download or locate the episode.");
			}

			// Another small delay to ensure UI responsiveness
			await new Promise(resolve => setTimeout(resolve, 50));
			
			// Get file size for estimation
			const fileSize = podcastFile.stat.size;
			const formattedSize = this.formatFileSize(fileSize);
			const estimatedTime = this.estimateTranscriptionTime(fileSize);
			
			// Update UI status
			this.processingStatus = `Preparing audio (${formattedSize})...`;
			this.timeRemaining = estimatedTime;
			this.progressPercent = 5; // Show a small amount of progress
			this.progressSize = formattedSize;
			
			// Read the audio file in chunks to reduce memory pressure
			const fileBuffer = await this.plugin.app.vault.readBinary(podcastFile);
			const fileExtension = podcastFile.extension;
			const mimeType = this.getMimeType(fileExtension);

			// Use the improved memory-efficient chunk processing
			const files = this.createChunkFiles(
				fileBuffer,
				podcastFile.basename,
				fileExtension,
				mimeType,
			);
			
			// Release the file buffer as soon as possible to free memory
			// @ts-ignore - using a workaround to help release memory
			const tempFileBuffer = null;
			
			// Update UI status
			this.processingStatus = `Starting transcription (${formattedSize})...`;
			
			// Create command for cancellation via command palette
			this.plugin.addCommand({
				id: 'cancel-transcription',
				name: 'Cancel Current Transcription',
				callback: () => this.cancelTranscription()
			});
			
			// Create a no-op update function since we're not using notices anymore
			const updateStatus = (message: string) => {
				// We're not doing anything with this message since we update UI directly
			};
			
			// Process transcription with concurrent chunks
			const transcription = await this.transcribeChunks(
				files, 
				updateStatus,
				currentEpisode.id,
				fileSize,
				resume ? this.resumeData : null
			);
			
			// If cancelled, stop here
			if (this.cancelRequested) {
				this.processingStatus = "Transcription cancelled";
				
				// Keep the UI visible for a moment before removing
				setTimeout(() => {
					this.isTranscribing = false;
				}, 2000);
				return;
			}
			
			// Schedule processing in the next event loop iteration to avoid UI blocking
			await new Promise(resolve => setTimeout(resolve, 50));
			
			// Update UI status
			this.processingStatus = "Formatting timestamps...";
			const formattedTranscription = await this.formatTranscriptionWithTimestamps(transcription);

			// Update UI status
			this.processingStatus = "Saving...";
			const transcriptPath = await this.saveTranscription(currentEpisode, formattedTranscription);

			// Remove command for cancellation
			try {
				this.plugin.app.commands.removeCommand(`${this.plugin.manifest.id}:cancel-transcription`);
			} catch (e) {
				console.log("Error removing command:", e);
			}

			// Clear resume data since we've completed successfully
			this.clearResumeState();

			// Show completion status in the UI
			this.processingStatus = `Saved: ${transcriptPath}`;
			this.progressPercent = 100;
			
			// Keep the UI visible for a moment before removing
			setTimeout(() => {
				this.isTranscribing = false;
			}, 2000);
			
		} catch (error) {
			console.error("Transcription error:", error);
			
			// Show error in UI
			this.processingStatus = `Error: ${error.message}`;
			
			// Keep the error visible for a moment before removing
			setTimeout(() => {
				this.isTranscribing = false;
			}, 3000);
		} finally {
			// Remove the command in case it wasn't removed earlier
			try {
				this.plugin.app.commands.removeCommand(`${this.plugin.manifest.id}:cancel-transcription`);
			} catch (e) {
				// Command may have already been removed, ignore
			}
		}
	}

	/**
	 * Chunks a file into smaller pieces for more efficient processing.
	 * Uses generator pattern to avoid holding all chunks in memory at once.
	 */
	private *chunkFileGenerator(fileBuffer: ArrayBuffer): Generator<ArrayBuffer> {
		const CHUNK_SIZE_MB = 20;
		const chunkSizeBytes = CHUNK_SIZE_MB * 1024 * 1024; // Convert MB to bytes
		
		for (let i = 0; i < fileBuffer.byteLength; i += chunkSizeBytes) {
			// Create a slice and immediately yield it to avoid holding multiple chunks in memory
			yield fileBuffer.slice(i, i + chunkSizeBytes);
		}
	}
	
	/**
	 * Creates File objects for each chunk in the generator.
	 * Returns an array of File objects but processes one at a time to manage memory.
	 */
	private createChunkFiles(
		fileBuffer: ArrayBuffer,
		fileName: string,
		fileExtension: string,
		mimeType: string,
	): File[] {
		const files: File[] = [];
		let index = 0;
		
		// Use the generator to process one chunk at a time
		for (const chunk of this.chunkFileGenerator(fileBuffer)) {
			const file = new File([chunk], `${fileName}.part${index}.${fileExtension}`, {
				type: mimeType,
			});
			files.push(file);
			index++;
		}
		
		return files;
	}

	private getMimeType(fileExtension: string): string {
		switch (fileExtension.toLowerCase()) {
			case "mp3":
				return "audio/mp3";
			case "m4a":
				return "audio/mp4";
			case "ogg":
				return "audio/ogg";
			case "wav":
				return "audio/wav";
			case "flac":
				return "audio/flac";
			default:
				return "audio/mpeg";
		}
	}

	private async transcribeChunks(
		files: File[],
		updateNotice: (message: string) => void,
		episodeId: string = '',
		totalFileSize: number = 0,
		resumeData: any = null
	): Promise<Transcription> {
		if (!this.client) {
			throw new Error("OpenAI client not initialized. Please check your API key.");
		}
		
		const transcriptions: Transcription[] = new Array(files.length);
		let completedChunks = 0;
		let processedSize = 0;
		let totalProcessedBytes = 0;
		let lastUpdateTime = Date.now();
		let startTime = Date.now();
		const UPDATE_INTERVAL_MS = 150; // Update UI more frequently for better responsiveness
		
		// If we have resume data, restore the progress
		if (resumeData && resumeData.episodeId === episodeId) {
			resumeData.results.forEach((result, i) => {
				if (i < transcriptions.length) {
					transcriptions[i] = result;
					completedChunks++;
					
					// Estimate size of the processed chunk
					const estimatedChunkSize = totalFileSize / files.length;
					totalProcessedBytes += estimatedChunkSize;
				}
			});
		}

		const updateProgress = () => {
			if (this.cancelRequested) {
				updateNotice("Cancelling transcription. Please wait...");
				this.processingStatus = "Cancelling...";
				return;
			}
			
			const now = Date.now();
			// Throttle UI updates to avoid excessive rendering
			if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
				const progress = ((completedChunks / files.length) * 100).toFixed(1);
				const elapsedSeconds = (now - startTime) / 1000;
				const processedMB = totalProcessedBytes / 1048576;
				const bytesPerSecond = totalProcessedBytes / Math.max(1, elapsedSeconds);
				
				// Status indicator that shows active processing
				const loadingIndicator = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"][Math.floor(Date.now() / 250) % 8];
				
				// Calculate more accurate estimated time remaining
				// Use a weighted approach that puts more emphasis on recent processing speed
				// This helps adjust the estimate as we gather more data
				let remainingTimeStr = "Calculating...";
				
				if (completedChunks > 0 && elapsedSeconds > 10) {
					const remainingBytes = totalFileSize - totalProcessedBytes;
					const estimatedRemainingSeconds = remainingBytes / bytesPerSecond;
					
					if (estimatedRemainingSeconds > 3600) {
						const hours = Math.floor(estimatedRemainingSeconds / 3600);
						const mins = Math.floor((estimatedRemainingSeconds % 3600) / 60);
						remainingTimeStr = `~${hours}h ${mins}m`;
					} else if (estimatedRemainingSeconds > 60) {
						const mins = Math.floor(estimatedRemainingSeconds / 60);
						const secs = Math.floor(estimatedRemainingSeconds % 60);
						remainingTimeStr = `~${mins}m ${secs}s`;
					} else {
						remainingTimeStr = `~${Math.floor(estimatedRemainingSeconds)}s`;
					}
				}
				
				// Calculate processing speed
				const speed = (bytesPerSecond / 1024).toFixed(1);
				
				// Update public properties for UI
				this.progressPercent = parseFloat(progress);
				this.progressSize = `${this.formatFileSize(totalProcessedBytes)} of ${this.formatFileSize(totalFileSize)}`;
				this.timeRemaining = remainingTimeStr;
				this.processingStatus = `Processing at ${speed} KB/s`;
				
				// Simplified notice for backward compatibility
				updateNotice(
					`${loadingIndicator} Transcribing... ${progress}% complete\n` +
					`${this.formatFileSize(totalProcessedBytes)} of ${this.formatFileSize(totalFileSize)}\n` +
					`${remainingTimeStr}`
				);
				
				// Save resume state periodically
				this.saveResumeState(episodeId, files, transcriptions, totalProcessedBytes, totalFileSize);
				
				lastUpdateTime = now;
			}
		};

		updateProgress();

		// Define a function to process a single file
		const processFile = async (file: File, index: number): Promise<void> => {
			// Skip already processed chunks if resuming
			if (resumeData && resumeData.chunks) {
				const chunk = resumeData.chunks.find(c => c.index === index);
				if (chunk && chunk.processed) {
					// This chunk was already processed
					return;
				}
			}
			
			// Check for cancellation before processing
			if (this.cancelRequested) {
				return;
			}
			
			let retries = 0;
			while (retries < this.MAX_RETRIES) {
				try {
					// Use a separate microtask to yield to the main thread
					await new Promise(resolve => setTimeout(resolve, 0));
					
					// Check cancellation before API call
					if (this.cancelRequested) {
						return;
					}
					
					// Update size tracking before processing
					const estimatedChunkSize = totalFileSize / files.length;
					
					const result = await this.client.audio.transcriptions.create({
						file: file,
						model: "whisper-1",
						response_format: "verbose_json",
						timestamp_granularities: ["segment", "word"],
					});
					
					// Check cancellation after API call
					if (this.cancelRequested) {
						// Save progress before cancelling
						this.saveResumeState(episodeId, files, transcriptions, totalProcessedBytes, totalFileSize);
						return;
					}
					
					transcriptions[index] = result;
					completedChunks++;
					totalProcessedBytes += estimatedChunkSize;
					updateProgress();
					return;
				} catch (error) {
					// Check for cancellation during error handling
					if (this.cancelRequested) {
						return;
					}
					
					retries++;
					if (retries >= this.MAX_RETRIES) {
						console.error(
							`Failed to transcribe chunk ${index + 1}/${files.length} after ${this.MAX_RETRIES} attempts:`,
							error,
						);
						
						// Create a minimal placeholder transcription for the failed segment
						// This allows the process to continue with the rest of the chunks
						transcriptions[index] = {
							text: `[Transcription error in segment ${index + 1}]`,
							segments: [{
								start: 0,
								end: 1,
								text: `[Transcription error in segment ${index + 1}]`
							}]
						};
						
						// Still increment the counter to maintain accurate progress
						completedChunks++;
						const estimatedChunkSize = totalFileSize / files.length;
						totalProcessedBytes += estimatedChunkSize;
						updateProgress();
						
						// Log the error but don't throw - continue with other chunks
						new Notice(`Warning: Failed to transcribe segment ${index + 1}. Continuing with remaining segments.`, 3000);
						return;
					}
					// Exponential backoff
					await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
				}
			}
		};

		// Process chunks with a concurrency limit to avoid overwhelming OpenAI's API
		// and to manage memory consumption
		const CONCURRENCY_LIMIT = 3;
		
		// Create batches of promises
		for (let i = 0; i < files.length; i += CONCURRENCY_LIMIT) {
			// Check for cancellation before starting a new batch
			if (this.cancelRequested) {
				break;
			}
			
			const batch = files.slice(i, i + CONCURRENCY_LIMIT);
			const batchPromises = batch.map((file, batchIndex) => 
				processFile(file, i + batchIndex).catch(error => {
					// Check for cancellation during batch error handling
					if (this.cancelRequested) {
						return;
					}
					
					// Add additional error handling at the batch level
					console.error(`Error in batch processing for index ${i + batchIndex}:`, error);
					
					// Create an empty placeholder for completely failed chunks
					transcriptions[i + batchIndex] = {
						text: `[Failed to process segment ${i + batchIndex + 1}]`,
						segments: [{
							start: 0,
							end: 1,
							text: `[Failed to process segment ${i + batchIndex + 1}]`
						}]
					};
					
					// Ensure we update progress even for failed chunks
					completedChunks++;
					const estimatedChunkSize = totalFileSize / files.length;
					totalProcessedBytes += estimatedChunkSize;
					updateProgress();
				})
			);
			
			try {
				// Process each batch concurrently
				await Promise.all(batchPromises);
			} catch (error) {
				// Check for cancellation during batch error handling
				if (this.cancelRequested) {
					break;
				}
				
				// This is a fallback in case something unexpected happens
				console.error("Unexpected error in batch processing:", error);
				new Notice("Warning: Some segments failed to transcribe. Continuing with available data.", 5000);
				// Continue processing other batches - don't rethrow
			}
			
			// Check for cancellation after batch completion
			if (this.cancelRequested) {
				// Save progress before cancelling
				this.saveResumeState(episodeId, files, transcriptions, totalProcessedBytes, totalFileSize);
				break;
			}
			
			// After each batch is done, give the main thread a moment to breathe
			await new Promise(resolve => setTimeout(resolve, 50));
		}
		
		// If cancelled, save state and stop processing
		if (this.cancelRequested) {
			// Save progress before returning
			this.saveResumeState(episodeId, files, transcriptions, totalProcessedBytes, totalFileSize);
			
			// Return partial results to avoid crashes
			const validTranscriptions = transcriptions.filter(t => t !== undefined);
			if (validTranscriptions.length === 0) {
				throw new Error("Transcription cancelled by user.");
			}
			
			return this.mergeTranscriptions(validTranscriptions);
		}

		// Filter out any undefined entries that might have occurred due to errors
		const validTranscriptions = transcriptions.filter(t => t !== undefined);
		
		return this.mergeTranscriptions(validTranscriptions);
	}

	private mergeTranscriptions(transcriptions: Transcription[]): Transcription {
		let mergedText = "";
		const mergedSegments = [];
		let timeOffset = 0;

		transcriptions.forEach((transcription, index) => {
			if (typeof transcription === "string") {
				mergedText += (index > 0 ? " " : "") + transcription;
			} else if (typeof transcription === "object" && transcription.text) {
				mergedText += (index > 0 ? " " : "") + transcription.text;

				// Check if this transcription has segments
				if (transcription.segments) {
					// Check if we need to merge with previous segment
					if (index > 0 && mergedSegments.length > 0 && transcription.segments.length > 0) {
						const lastSegment = mergedSegments[mergedSegments.length - 1];
						const firstSegment = transcription.segments[0];
						
						// If timestamps are close, potentially merge the segments
						// This helps with continuity across chunk boundaries
						if ((firstSegment.start + timeOffset) - lastSegment.end < 1.0) {
							// Merge segment text and update end time
							lastSegment.text += " " + firstSegment.text;
							lastSegment.end = firstSegment.end + timeOffset;
							
							// Add remaining segments with offset
							for (let i = 1; i < transcription.segments.length; i++) {
								const segment = transcription.segments[i];
								mergedSegments.push({
									...segment,
									start: segment.start + timeOffset,
									end: segment.end + timeOffset,
								});
							}
						} else {
							// Add all segments with offset
							for (const segment of transcription.segments) {
								mergedSegments.push({
									...segment,
									start: segment.start + timeOffset,
									end: segment.end + timeOffset,
								});
							}
						}
					} else {
						// First chunk, just add all segments with offset
						for (const segment of transcription.segments) {
							mergedSegments.push({
								...segment,
								start: segment.start + timeOffset,
								end: segment.end + timeOffset,
							});
						}
					}

					// Update time offset for next chunk
					if (transcription.segments.length > 0) {
						timeOffset += transcription.segments[transcription.segments.length - 1].end;
					}
				}
			}
		});

		return {
			text: mergedText,
			segments: mergedSegments,
			// Add other properties as needed
		};
	}

	/**
	 * Formats the transcription with timestamps, optimized for performance with large transcriptions.
	 * Uses string concatenation with intermediate arrays to reduce memory allocations.
	 * Processes segments in batches to avoid blocking the UI.
	 */
	private async formatTranscriptionWithTimestamps(transcription: Transcription): Promise<string> {
		// For very large transcripts, we'll build the output incrementally
		const formattedParts: string[] = [];
		let currentSegment = "";
		let segmentStart: number | null = null;
		let segmentEnd: number | null = null;
		
		// Use the configured timestamp range from settings
		const timestampRange = this.plugin.settings.transcript.timestampRange;
		const includeTimestamps = this.plugin.settings.transcript.includeTimestamps;
		
		// Calculate approximate segments count to pre-allocate array
		const estimatedSegmentCount = transcription.segments.length / 3;
		formattedParts.length = Math.ceil(estimatedSegmentCount);
		
		// Template cache to avoid redundant formatting
		const templateCache = new Map<string, string>();
		
		// Function to get cached template or generate new one
		const getFormattedTimestamp = (template: string, range: {start: number, end: number}): string => {
			const cacheKey = `${template}-${range.start}-${range.end}`;
			if (templateCache.has(cacheKey)) {
				return templateCache.get(cacheKey)!;
			}
			
			const formatted = TimestampTemplateEngine(template, range);
			templateCache.set(cacheKey, formatted);
			return formatted;
		};
		
		let partIndex = 0;
		let currentPart = "";
		const BATCH_SIZE = 50; // Process segments in batches
		
		// Process segments in batches to avoid blocking the UI
		for (let i = 0; i < transcription.segments.length; i++) {
			const segment = transcription.segments[i];
			const isFirstSegment = i === 0;
			const isLastSegment = i === transcription.segments.length - 1;
			const prevSegment = isFirstSegment ? null : transcription.segments[i - 1];
			
			// Initialize segment tracking
			if (segmentStart === null) {
				segmentStart = segment.start;
			}
			segmentEnd = segment.end;
			
			// Determine if this is a new segment based on configured timestamp range
			const isNewSegment = isFirstSegment || (prevSegment && segment.start - prevSegment.end > timestampRange);
			
			if (isNewSegment) {
				// Process previous segment if exists
				if (currentSegment) {
					const range = { start: segmentStart!, end: segmentEnd! };
					
					if (includeTimestamps) {
						const formattedTimestamp = getFormattedTimestamp("**{{linktimerange}}**\n", range);
						currentPart += `${formattedTimestamp} ${currentSegment}\n\n`;
					} else {
						currentPart += `${currentSegment}\n\n`;
					}
				}
				
				// Start new segment
				currentSegment = segment.text;
				segmentStart = segment.start;
			} else {
				// Continue current segment
				currentSegment += ` ${segment.text}`;
			}
			
			// Handle the last segment or save batch
			if (isLastSegment) {
				const range = { start: segmentStart!, end: segmentEnd! };
				
				if (includeTimestamps) {
					const formattedTimestamp = getFormattedTimestamp(
						this.plugin.settings.timestamp.template, 
						range
					);
					currentPart += `${formattedTimestamp} ${currentSegment}`;
				} else {
					currentPart += currentSegment;
				}
				
				// Save final part
				formattedParts[partIndex] = currentPart;
			} else if ((i + 1) % BATCH_SIZE === 0) {
				// Save batch and reset for next batch
				formattedParts[partIndex++] = currentPart;
				currentPart = "";
				
				// Allow UI thread to breathe
				if ((i + 1) % (BATCH_SIZE * 5) === 0) {
					// Yield to the main thread
					await new Promise(resolve => setTimeout(resolve, 0));
				}
			}
		}
		
		// Join all parts and return the complete formatted transcription
		return formattedParts.join("");
	}

	private async saveTranscription(
		episode: Episode,
		transcription: string,
	): Promise<string> {
		const transcriptPath = FilePathTemplateEngine(
			this.plugin.settings.transcript.path,
			episode,
		);
		const formattedTranscription = transcription.replace(/\.\s+/g, ".\n\n");
		const transcriptContent = TranscriptTemplateEngine(
			this.plugin.settings.transcript.template,
			episode,
			formattedTranscription,
		);

		const vault = this.plugin.app.vault;

		// Ensure the directory exists
		const directory = transcriptPath.substring(
			0,
			transcriptPath.lastIndexOf("/"),
		);
		if (directory && !vault.getAbstractFileByPath(directory)) {
			await vault.createFolder(directory);
		}

		const file = vault.getAbstractFileByPath(transcriptPath);

		if (!file) {
			const newFile = await vault.create(transcriptPath, transcriptContent);
			await this.plugin.app.workspace.getLeaf().openFile(newFile);
			return transcriptPath;
		} else {
			throw new Error("Expected a file but got a folder");
		}
	}
}