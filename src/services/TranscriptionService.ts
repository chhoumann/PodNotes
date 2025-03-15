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
import { get } from "svelte/store";
import { transcriptionProgress } from "../store";

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
	 * Save resumable state with fallback options for better reliability
	 */
	private saveResumeState(
		episodeId: string, 
		totalChunks: number, 
		results: any[], 
		completedSize: number, 
		totalSize: number
	): void {
		// Create chunks list from total and processed results
		const chunks = Array.from({ length: totalChunks }, (_, index) => ({ 
			processed: results[index] !== undefined, 
			index 
		}));
		
		// Store filtered results (only completed ones)
		const validResults = results.filter(r => r !== undefined);
		
		// Create resume data object
		this.resumeData = {
			episodeId,
			timestamp: Date.now(),
			chunks,
			results: validResults,
			completedSize,
			totalSize
		};
		
		// Try localStorage first
		try {
			localStorage.setItem(`podnotes-resume-${episodeId}`, JSON.stringify(this.resumeData));
		} catch (error) {
			console.warn("Failed to save resume state to localStorage:", error);
			
			// Fall back to plugin data storage
			try {
				this.plugin.saveData(`transcription-resume-${episodeId}`, this.resumeData);
			} catch (fallbackError) {
				console.error("Failed to save resume state to plugin data:", fallbackError);
				
				// Log but don't interrupt transcription
				new Notice("Warning: Failed to save resume state", 3000);
			}
		}
		
		// Update UI with resume availability
		this.updateProgressStore({
			hasResumableTranscription: true
		});
	}
	
	/**
	 * Check if there's a resumable transcription for the given episode
	 * Checks both localStorage and plugin data storage
	 */
	hasResumableTranscription(episodeId: string): boolean {
		// Check localStorage first
		try {
			const savedData = localStorage.getItem(`podnotes-resume-${episodeId}`);
			if (savedData) {
				const resumeData = JSON.parse(savedData);
				// Verify data is valid and for this episode
				if (resumeData && resumeData.episodeId === episodeId) {
					return true;
				}
			}
		} catch {
			// Ignore localStorage errors and try plugin data
		}
		
		// Fallback to plugin data
		try {
			const pluginData = this.plugin.loadData(`transcription-resume-${episodeId}`);
			if (pluginData && pluginData.episodeId === episodeId) {
				return true;
			}
		} catch {
			// Ignore errors
		}
		
		return false;
	}
	
	/**
	 * Check if a transcript already exists for the given episode
	 */
	hasExistingTranscript(episodeId: string): boolean {
		try {
			// Find the episode from the ID
			// This requires getting the current episode
			const currentEpisode = this.plugin.api.podcast;
			if (!currentEpisode || currentEpisode.id !== episodeId) {
				return false;
			}
			
			// Check if transcript file exists
			const transcriptPath = FilePathTemplateEngine(
				this.plugin.settings.transcript.path,
				currentEpisode,
			);
			
			const existingFile = this.plugin.app.vault.getAbstractFileByPath(transcriptPath);
			return existingFile !== null;
		} catch (error) {
			console.error("Error checking for existing transcript:", error);
			return false;
		}
	}
	
	/**
	 * Clear resume state from all storage locations
	 */
	private clearResumeState(): void {
		// Reset local state
		this.resumeData = null;
		
		// Get current episode ID for targeted clear
		const currentEpisodeId = this.plugin.api.podcast?.id;
		if (!currentEpisodeId) return;
		
		// Clear from localStorage
		try {
			localStorage.removeItem(`podnotes-resume-${currentEpisodeId}`);
			
			// Also try to clean up legacy format for compatibility
			localStorage.removeItem('podnotes-resume-transcription');
		} catch (error) {
			console.warn("Failed to clear resume state from localStorage:", error);
		}
		
		// Clear from plugin data
		try {
			this.plugin.saveData(`transcription-resume-${currentEpisodeId}`, null);
		} catch (error) {
			console.warn("Failed to clear resume state from plugin data:", error);
		}
		
		// Update UI state
		this.updateProgressStore({
			hasResumableTranscription: false
		});
	}

	/**
	 * Transcribes the current episode asynchronously with true streaming to optimize memory usage.
	 * Uses non-blocking approach to maintain responsiveness of the Obsidian UI.
	 * @param resume Whether to attempt to resume a previously interrupted transcription
	 */
	async transcribeCurrentEpisode(resume: boolean = false): Promise<void> {
		// Get current episode first
		const currentEpisode = this.plugin.api.podcast;
		if (!currentEpisode) {
			this.updateProgressStore({
				processingStatus: "Error: No episode is playing",
				isTranscribing: false
			});
			return;
		}
		
		// Set initial state
		this.updateProgressStore({
			isTranscribing: true,
			progressPercent: 0.1,
			progressSize: "0 KB",
			timeRemaining: "Calculating...",
			processingStatus: "Preparing...",
			currentEpisodeId: currentEpisode.id,
			hasResumableTranscription: resume || this.hasResumableTranscription(currentEpisode.id),
			hasExistingTranscript: this.hasExistingTranscript(currentEpisode.id)
		});
		
		// Validate API key with a proper validation method
		try {
			const validationResult = await this.validateApiKey();
			if (!validationResult.valid) {
				this.updateProgressStore({
					processingStatus: `Error: ${validationResult.reason || "Invalid API key"}`,
					isTranscribing: false
				});
				return;
			}
		} catch (error) {
			this.updateProgressStore({
				processingStatus: `Error validating API key: ${error.message}`,
				isTranscribing: false
			});
			return;
		}
		
		// Check if transcript already exists (only if not resuming)
		if (!resume && this.hasExistingTranscript(currentEpisode.id)) {
			this.updateProgressStore({ isTranscribing: false });
			return;
		}

		// Reset cancellation flag
		this.cancelRequested = false;

		try {
			this.updateProgressStore({ processingStatus: "Downloading episode..." });
			
			// Get the episode file
			const downloadPath = await downloadEpisode(
				currentEpisode,
				this.plugin.settings.download.path,
			);
			const podcastFile =
				this.plugin.app.vault.getAbstractFileByPath(downloadPath);
			if (!podcastFile || !(podcastFile instanceof TFile)) {
				throw new Error("Failed to download or locate the episode.");
			}
			
			// Get file size for estimation
			const fileSize = podcastFile.stat.size;
			const formattedSize = this.formatFileSize(fileSize);
			const estimatedTime = this.estimateTranscriptionTime(fileSize);
			
			this.updateProgressStore({
				processingStatus: `Preparing audio (${formattedSize})...`,
				timeRemaining: estimatedTime,
				progressPercent: 5,
				progressSize: formattedSize
			});
			
			// Create command for cancellation via command palette
			this.plugin.addCommand({
				id: 'cancel-transcription',
				name: 'Cancel Current Transcription',
				callback: () => this.cancelTranscription()
			});
			
			// Process the audio file in a true streaming manner
			const chunkSize = this.calculateOptimalChunkSize(fileSize);
			const fileExtension = podcastFile.extension;
			const mimeType = this.getMimeType(fileExtension);
			
			this.updateProgressStore({
				processingStatus: `Starting transcription (${formattedSize})...`
			});
			
			// Process transcription with streamed chunks
			const transcription = await this.processAudioFileStreaming(
				podcastFile,
				chunkSize,
				fileSize,
				mimeType,
				currentEpisode.id,
				resume ? this.resumeData : null
			);
			
			// If cancelled, stop here
			if (this.cancelRequested) {
				this.updateProgressStore({
					processingStatus: "Transcription cancelled",
					isTranscribing: false
				});
				return;
			}
			
			// Use requestAnimationFrame for natural async boundaries
			await new Promise(resolve => requestAnimationFrame(resolve));
			
			this.updateProgressStore({ 
				processingStatus: "Formatting timestamps...",
				progressPercent: 90
			});
			
			const formattedTranscription = await this.formatTranscriptionWithTimestamps(transcription);

			this.updateProgressStore({ 
				processingStatus: "Saving...",
				progressPercent: 95 
			});
			
			const transcriptPath = await this.saveTranscription(currentEpisode, formattedTranscription);

			// Remove command for cancellation
			try {
				this.plugin.app.commands.removeCommand(`${this.plugin.manifest.id}:cancel-transcription`);
			} catch (e) {
				console.log("Error removing command:", e);
			}

			// Clear resume data since we've completed successfully
			this.clearResumeState();

			// Show completion and auto-hide after delay
			this.updateProgressStore({
				processingStatus: `Saved: ${transcriptPath}`,
				progressPercent: 100
			});
			
			setTimeout(() => {
				this.updateProgressStore({ isTranscribing: false });
			}, 2000);
			
		} catch (error) {
			console.error("Transcription error:", error);
			
			this.updateProgressStore({
				processingStatus: `Error: ${error.message}`,
				isTranscribing: false
			});
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
	 * Updates the central progress store to maintain a single source of truth
	 */
	private updateProgressStore(update: Partial<import('../store').TranscriptionProgress>): void {
		// Also update local properties for backward compatibility
		if (update.isTranscribing !== undefined) this.isTranscribing = update.isTranscribing;
		if (update.progressPercent !== undefined) this.progressPercent = update.progressPercent;
		if (update.progressSize !== undefined) this.progressSize = update.progressSize;
		if (update.timeRemaining !== undefined) this.timeRemaining = update.timeRemaining;
		if (update.processingStatus !== undefined) this.processingStatus = update.processingStatus;
		
		// Update the central store
		transcriptionProgress.update(state => ({...state, ...update}));
	}
	
	/**
	 * Calculate optimal chunk size based on file size and available memory
	 */
	private calculateOptimalChunkSize(fileSize: number): number {
		// Base chunk size on file characteristics
		const baseChunkSize = 20 * 1024 * 1024; // 20MB base (original size)
		
		if (fileSize > 100 * 1024 * 1024) { // Large files > 100MB
			return Math.min(baseChunkSize, Math.floor(4 * 1024 * 1024)); // Adjust for very large files
		}
		return baseChunkSize;
	}
	
	/**
	 * Thoroughly validates the OpenAI API key by making a test API call
	 */
	private async validateApiKey(): Promise<{valid: boolean, reason?: string}> {
		const apiKey = this.plugin.settings.openAIApiKey;
		
		if (!apiKey || apiKey.trim() === "") {
			return {valid: false, reason: "OpenAI API key is required for transcription"};
		}
		
		if (!apiKey.startsWith("sk-")) {
			return {valid: false, reason: "Invalid OpenAI API key format"};
		}
		
		try {
			this.client = new OpenAI({
				apiKey: apiKey,
				dangerouslyAllowBrowser: true,
			});
			
			// Make a minimal API call to test key validity
			await this.client.models.list();
			return {valid: true};
		} catch (error) {
			console.error("Error validating OpenAI client:", error);
			
			if (error.status === 401) {
				return {valid: false, reason: "Invalid API key or insufficient permissions"};
			}
			if (error.status === 429) {
				return {valid: false, reason: "API rate limit exceeded. Please try again later"};
			}
			
			return {valid: false, reason: error.message};
		}
	}
	
	/**
	 * Process an audio file in true streaming fashion to minimize memory usage
	 */
	private async processAudioFileStreaming(
		file: TFile,
		chunkSize: number,
		totalSize: number,
		mimeType: string,
		episodeId: string,
		resumeData: any = null
	): Promise<Transcription> {
		if (!this.client) {
			throw new Error("OpenAI client not initialized");
		}
		
		const totalChunks = Math.ceil(totalSize / chunkSize);
		const transcriptions: Transcription[] = new Array(totalChunks);
		let completedChunks = 0;
		let totalProcessedBytes = 0;
		let startTime = Date.now();
		
		// Track missing segments for better error reporting
		const missingSegments: {index: number, startTime: number, endTime: number}[] = [];
		
		// If resuming, restore progress
		if (resumeData && resumeData.episodeId === episodeId) {
			resumeData.results.forEach((result, i) => {
				if (i < transcriptions.length) {
					transcriptions[i] = result;
					completedChunks++;
					const estimatedChunkSize = Math.min(chunkSize, totalSize - (i * chunkSize));
					totalProcessedBytes += estimatedChunkSize;
				}
			});
		}

		const updateProgress = () => {
			if (this.cancelRequested) {
				this.updateProgressStore({ processingStatus: "Cancelling..." });
				return;
			}
			
			const progress = ((completedChunks / totalChunks) * 100);
			const elapsedSeconds = (Date.now() - startTime) / 1000;
			const bytesPerSecond = totalProcessedBytes / Math.max(1, elapsedSeconds);
			
			let remainingTimeStr = "Calculating...";
			
			if (completedChunks > 0 && elapsedSeconds > 10) {
				const remainingBytes = totalSize - totalProcessedBytes;
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
			
			const speed = (bytesPerSecond / 1024).toFixed(1);
			
			this.updateProgressStore({
				progressPercent: progress,
				progressSize: `${this.formatFileSize(totalProcessedBytes)} of ${this.formatFileSize(totalSize)}`,
				timeRemaining: remainingTimeStr,
				processingStatus: `Processing at ${speed} KB/s`
			});
			
			// Save resume state
			this.saveResumeState(episodeId, totalChunks, transcriptions, totalProcessedBytes, totalSize);
		};

		updateProgress();
		
		// Process chunks with a concurrency limit
		const CONCURRENCY_LIMIT = 3;
		
		for (let startChunk = 0; startChunk < totalChunks; startChunk += CONCURRENCY_LIMIT) {
			if (this.cancelRequested) break;
			
			const endChunk = Math.min(startChunk + CONCURRENCY_LIMIT, totalChunks);
			const chunkPromises = [];
			
			for (let i = startChunk; i < endChunk; i++) {
				// Skip already processed chunks if resuming
				if (resumeData && resumeData.chunks) {
					const chunk = resumeData.chunks.find(c => c.index === i);
					if (chunk && chunk.processed) continue;
				}
				
				// If cancelled, don't process more chunks
				if (this.cancelRequested) break;
				
				const startByte = i * chunkSize;
				const endByte = Math.min(startByte + chunkSize, totalSize);
				const chunkPromise = this.processChunk(file, mimeType, startByte, endByte, i, totalChunks)
					.then(result => {
						transcriptions[i] = result;
						completedChunks++;
						totalProcessedBytes += (endByte - startByte);
						updateProgress();
					})
					.catch(error => {
						// Handle errors for individual chunks
						console.error(`Error processing chunk ${i}:`, error);
						
						// Estimate time position for error reporting
						const startTime = this.estimateTimePosition(i, totalChunks, totalSize);
						const endTime = this.estimateTimePosition(i + 1, totalChunks, totalSize);
						
						missingSegments.push({index: i, startTime, endTime});
						
						// Create meaningful placeholder for the error
						transcriptions[i] = {
							text: `[Content missing from ${formatTime(startTime)} to ${formatTime(endTime)} due to transcription error]`,
							segments: [{
								start: startTime,
								end: endTime,
								text: `[Transcription error. You can try again later to fill this gap.]`
							}]
						};
						
						completedChunks++;
						totalProcessedBytes += (endByte - startByte);
						updateProgress();
					});
				
				chunkPromises.push(chunkPromise);
			}
			
			// Wait for current batch to complete
			await Promise.all(chunkPromises);
			
			// Check for cancellation
			if (this.cancelRequested) {
				this.saveResumeState(episodeId, totalChunks, transcriptions, totalProcessedBytes, totalSize);
				break;
			}
			
			// Yield to main thread after each batch
			await new Promise(resolve => requestAnimationFrame(resolve));
		}
		
		// If cancelled, return partial results
		if (this.cancelRequested) {
			const validTranscriptions = transcriptions.filter(t => t !== undefined);
			if (validTranscriptions.length === 0) {
				throw new Error("Transcription cancelled");
			}
			return this.mergeTranscriptions(validTranscriptions);
		}
		
		// Filter out undefined entries
		const validTranscriptions = transcriptions.filter(t => t !== undefined);
		return this.mergeTranscriptions(validTranscriptions);
	}
	
	/**
	 * Process a single chunk of the audio file
	 */
	private async processChunk(
		file: TFile,
		mimeType: string,
		startByte: number,
		endByte: number,
		index: number,
		totalChunks: number
	): Promise<Transcription> {
		if (!this.client) {
			throw new Error("OpenAI client not initialized");
		}
		
		let retries = 0;
		
		while (retries < this.MAX_RETRIES) {
			try {
				// Read just the chunk we need
				const chunkBuffer = await this.plugin.app.vault.adapter.readBinary(
					file.path, 
					startByte, 
					endByte - startByte
				);
				
				// Create a file object for this chunk
				const chunkFile = new File(
					[chunkBuffer], 
					`chunk-${index}.${file.extension}`, 
					{ type: mimeType }
				);
				
				// Send to OpenAI for transcription
				const result = await this.client.audio.transcriptions.create({
					file: chunkFile,
					model: "whisper-1",
					response_format: "verbose_json",
					timestamp_granularities: ["segment", "word"],
				});
				
				// Check for cancellation
				if (this.cancelRequested) {
					return {
						text: "",
						segments: []
					};
				}
				
				return result;
			} catch (error) {
				retries++;
				
				// Check for cancellation
				if (this.cancelRequested) {
					return {
						text: "",
						segments: []
					};
				}
				
				// Handle specific error types
				if (error.status === 429) {
					console.warn("Rate limit exceeded, retrying after delay...");
					await new Promise(resolve => setTimeout(resolve, 2000 * retries));
				} else if (error.status >= 500) {
					console.warn("Server error, retrying after delay...");
					await new Promise(resolve => setTimeout(resolve, 1000 * retries));
				} else if (retries >= this.MAX_RETRIES) {
					// Give up after max retries
					console.error(`Failed to transcribe chunk ${index} after ${this.MAX_RETRIES} attempts:`, error);
					
					// Create a more informative placeholder
					const startTime = this.estimateTimePosition(index, totalChunks, 0);
					const endTime = this.estimateTimePosition(index + 1, totalChunks, 0);
					
					return {
						text: `[Transcription error in segment ${index + 1}]`,
						segments: [{
							start: startTime,
							end: endTime,
							text: `[Transcription error in segment ${index + 1}]`
						}]
					};
				} else {
					// Generic error handling
					await new Promise(resolve => setTimeout(resolve, 1000 * retries));
				}
			}
		}
		
		// This shouldn't be reached, but TypeScript needs it
		throw new Error(`Failed to process chunk ${index}`);
	}
	
	/**
	 * Estimate the time position within audio based on chunk index
	 */
	private estimateTimePosition(chunkIndex: number, totalChunks: number, totalDuration: number): number {
		if (totalDuration === 0) {
			// Just use chunk index as seconds if we don't know duration
			return chunkIndex * 60;
		}
		return (chunkIndex / totalChunks) * totalDuration;
	}

	/**
	 * Helper method to get the MIME type based on file extension
	 */
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