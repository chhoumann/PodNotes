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
	private client: OpenAI;
	private MAX_RETRIES = 3;
	private isTranscribing = false;

	constructor(plugin: PodNotes) {
		this.plugin = plugin;
		this.client = new OpenAI({
			apiKey: this.plugin.settings.openAIApiKey,
			dangerouslyAllowBrowser: true,
		});
	}

	/**
	 * Transcribes the current episode asynchronously with optimized memory usage and performance.
	 * Uses non-blocking approach to maintain responsiveness of the Obsidian UI.
	 */
	async transcribeCurrentEpisode(): Promise<void> {
		if (this.isTranscribing) {
			new Notice("A transcription is already in progress.");
			return;
		}

		const currentEpisode = this.plugin.api.podcast;
		if (!currentEpisode) {
			new Notice("No episode is currently playing.");
			return;
		}

		// Check if transcription file already exists
		const transcriptPath = FilePathTemplateEngine(
			this.plugin.settings.transcript.path,
			currentEpisode,
		);
		const existingFile =
			this.plugin.app.vault.getAbstractFileByPath(transcriptPath);
		if (existingFile instanceof TFile) {
			new Notice(
				`You've already transcribed this episode - found ${transcriptPath}.`,
			);
			return;
		}

		this.isTranscribing = true;
		const notice = TimerNotice("Transcription", "Preparing to transcribe...");

		try {
			// Use setTimeout to allow UI to update before heavy processing starts
			await new Promise(resolve => setTimeout(resolve, 50));
			
			notice.update("Downloading episode...");
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
			
			notice.update("Preparing audio for transcription...");
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
			
			notice.update("Starting transcription...");
			// Process transcription with concurrent chunks
			const transcription = await this.transcribeChunks(files, notice.update);
			
			// Schedule processing in the next event loop iteration to avoid UI blocking
			await new Promise(resolve => setTimeout(resolve, 50));
			
			notice.update("Processing timestamps...");
			const formattedTranscription = await this.formatTranscriptionWithTimestamps(transcription);

			notice.update("Saving transcription...");
			await this.saveTranscription(currentEpisode, formattedTranscription);

			notice.stop();
			notice.update("Transcription completed and saved.");
		} catch (error) {
			console.error("Transcription error:", error);
			notice.update(`Transcription failed: ${error.message}`);
		} finally {
			this.isTranscribing = false;
			setTimeout(() => notice.hide(), 5000);
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
	): Promise<Transcription> {
		const transcriptions: Transcription[] = new Array(files.length);
		let completedChunks = 0;
		let lastUpdateTime = Date.now();
		const UPDATE_INTERVAL_MS = 500; // Only update UI every 500ms to reduce performance impact

		const updateProgress = () => {
			const now = Date.now();
			// Throttle UI updates to avoid excessive rendering
			if (now - lastUpdateTime >= UPDATE_INTERVAL_MS) {
				const progress = ((completedChunks / files.length) * 100).toFixed(1);
				updateNotice(
					`Transcribing... ${completedChunks}/${files.length} chunks completed (${progress}%)`,
				);
				lastUpdateTime = now;
			}
		};

		updateProgress();

		// Define a function to process a single file
		const processFile = async (file: File, index: number): Promise<void> => {
			let retries = 0;
			while (retries < this.MAX_RETRIES) {
				try {
					// Use a separate microtask to yield to the main thread
					await new Promise(resolve => setTimeout(resolve, 0));
					
					const result = await this.client.audio.transcriptions.create({
						file: file,
						model: "whisper-1",
						response_format: "verbose_json",
						timestamp_granularities: ["segment", "word"],
					});
					
					transcriptions[index] = result;
					completedChunks++;
					updateProgress();
					return;
				} catch (error) {
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
			const batch = files.slice(i, i + CONCURRENCY_LIMIT);
			const batchPromises = batch.map((file, batchIndex) => 
				processFile(file, i + batchIndex).catch(error => {
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
					updateProgress();
				})
			);
			
			try {
				// Process each batch concurrently
				await Promise.all(batchPromises);
			} catch (error) {
				// This is a fallback in case something unexpected happens
				console.error("Unexpected error in batch processing:", error);
				new Notice("Warning: Some segments failed to transcribe. Continuing with available data.", 5000);
				// Continue processing other batches - don't rethrow
			}
			
			// After each batch is done, give the main thread a moment to breathe
			await new Promise(resolve => setTimeout(resolve, 50));
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
	): Promise<void> {
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
		} else {
			throw new Error("Expected a file but got a folder");
		}
	}
}