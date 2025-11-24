import { Notice, TFile } from "obsidian";
import type { OpenAI } from "openai";
import type PodNotes from "../main";
import { downloadEpisode } from "../downloadEpisode";
import {
	FilePathTemplateEngine,
	TranscriptTemplateEngine,
} from "../TemplateEngine";
import type { Episode } from "src/types/Episode";

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
	private cachedApiKey: string | null = null;
	private MAX_RETRIES = 3;
	private readonly CHUNK_SIZE_BYTES = 20 * 1024 * 1024;
	private readonly WAV_HEADER_SIZE = 44;
	private readonly PCM_BYTES_PER_SAMPLE = 2;
	private readonly MAX_CONCURRENT_TRANSCRIPTIONS = 2;
	private readonly MAX_CONCURRENT_CHUNK_TRANSCRIPTIONS = 3;
	private pendingEpisodes: Episode[] = [];
	private activeTranscriptions = new Set<string>();

	constructor(plugin: PodNotes) {
		this.plugin = plugin;
	}

	async transcribeCurrentEpisode(): Promise<void> {
		if (!this.plugin.settings.openAIApiKey?.trim()) {
			new Notice(
				"Please add your OpenAI API key in the transcript settings first.",
			);
			return;
		}

		const currentEpisode = this.plugin.api.podcast;
		if (!currentEpisode) {
			new Notice("No episode is currently playing.");
			return;
		}

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

		const episodeKey = this.getEpisodeKey(currentEpisode);
		const isAlreadyQueued =
			this.pendingEpisodes.some(
				(episode) => this.getEpisodeKey(episode) === episodeKey,
			) || this.activeTranscriptions.has(episodeKey);

		if (isAlreadyQueued) {
			new Notice("This episode is already queued or transcribing.");
			return;
		}

		this.pendingEpisodes.push(currentEpisode);
		new Notice(
			`Queued "${currentEpisode.title}" for transcription. It will start automatically.`,
		);
		this.drainQueue();
	}

	private drainQueue(): void {
		while (
			this.activeTranscriptions.size < this.MAX_CONCURRENT_TRANSCRIPTIONS &&
			this.pendingEpisodes.length > 0
		) {
			const nextEpisode = this.pendingEpisodes.shift();
			if (!nextEpisode) {
				return;
			}

			const episodeKey = this.getEpisodeKey(nextEpisode);
			this.activeTranscriptions.add(episodeKey);

			void this.transcribeEpisode(nextEpisode).finally(() => {
				this.activeTranscriptions.delete(episodeKey);
				this.drainQueue();
			});
		}
	}

	private getEpisodeKey(episode: Episode): string {
		return `${episode.podcastName}:${episode.title}`;
	}

	private async transcribeEpisode(episode: Episode): Promise<void> {
		const notice = TimerNotice(
			`Transcription: ${episode.title}`,
			"Preparing to transcribe...",
		);

		try {
			const transcriptPath = FilePathTemplateEngine(
				this.plugin.settings.transcript.path,
				episode,
			);
			const existingFile =
				this.plugin.app.vault.getAbstractFileByPath(transcriptPath);
			if (existingFile instanceof TFile) {
				notice.stop();
				notice.update(
					`Transcript already exists - skipped (${transcriptPath}).`,
				);
				return;
			}

			notice.update("Downloading episode...");
			const downloadPath = await downloadEpisode(
				episode,
				this.plugin.settings.download.path,
			);
			const podcastFile =
				this.plugin.app.vault.getAbstractFileByPath(downloadPath);
			if (!podcastFile || !(podcastFile instanceof TFile)) {
				throw new Error("Failed to download or locate the episode.");
			}

			notice.update("Preparing audio for transcription...");
			const fileBuffer = await this.plugin.app.vault.readBinary(podcastFile);
			const fileExtension = podcastFile.extension;
			const mimeType = this.getMimeType(fileExtension);

			notice.update("Creating audio chunks...");
			const files = await this.createChunkFiles({
				buffer: fileBuffer,
				basename: podcastFile.basename,
				extension: fileExtension,
				mimeType,
			});

			notice.update("Starting transcription...");
			const transcription = await this.transcribeChunks(files, notice.update);

			notice.update("Saving transcription...");
			await this.saveTranscription(episode, transcription);

			notice.stop();
			notice.update("Transcription completed and saved.");
		} catch (error) {
			console.error("Transcription error:", error);
			const message = error instanceof Error ? error.message : String(error);
			notice.stop();
			notice.update(`Transcription failed: ${message}`);
		} finally {
			notice.stop();
			setTimeout(() => notice.hide(), 5000);
		}
	}

	private async createChunkFiles({
		buffer,
		basename,
		extension,
		mimeType,
	}: {
		buffer: ArrayBuffer;
		basename: string;
		extension: string;
		mimeType: string;
	}): Promise<File[]> {
		if (this.shouldConvertToWav(extension, mimeType)) {
			const wavChunks = await this.convertToWavChunks(buffer, basename);
			if (wavChunks.length > 0) {
				return wavChunks;
			}
		}

		return this.createBinaryChunkFiles(buffer, basename, extension, mimeType);
	}

	private shouldConvertToWav(extension: string, mimeType: string): boolean {
		const normalizedExtension = extension.toLowerCase();
		return normalizedExtension === "m4a" || mimeType === "audio/mp4";
	}

	private createBinaryChunkFiles(
		buffer: ArrayBuffer,
		basename: string,
		extension: string,
		mimeType: string,
	): File[] {
		if (buffer.byteLength <= this.CHUNK_SIZE_BYTES) {
			return [
				new File([buffer], `${basename}.${extension}`, {
					type: mimeType,
				}),
			];
		}

		const files: File[] = [];
		for (
			let offset = 0, index = 0;
			offset < buffer.byteLength;
			offset += this.CHUNK_SIZE_BYTES, index++
		) {
			const chunk = buffer.slice(offset, offset + this.CHUNK_SIZE_BYTES);
			files.push(
				new File([chunk], `${basename}.part${index}.${extension}`, {
					type: mimeType,
				}),
			);
		}

		return files;
	}

	private async convertToWavChunks(
		buffer: ArrayBuffer,
		basename: string,
	): Promise<File[]> {
		const audioContext = this.createAudioContext();
		if (!audioContext) return [];

		try {
			const audioBuffer = await audioContext.decodeAudioData(buffer.slice(0));
			return this.renderWavChunks(audioBuffer, basename);
		} catch (error) {
			console.warn("Failed to convert audio buffer for transcription", error);
			return [];
		} finally {
			try {
				await audioContext.close();
			} catch (error) {
				console.warn("Failed to close audio context", error);
			}
		}
	}

	private createAudioContext(): AudioContext | null {
		if (typeof window === "undefined") {
			return null;
		}

		const contextCtor =
			window.AudioContext ||
			(window as typeof window & { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		if (!contextCtor) {
			return null;
		}

		return new contextCtor();
	}

	private renderWavChunks(audioBuffer: AudioBuffer, basename: string): File[] {
		const numChannels = audioBuffer.numberOfChannels;
		const bytesPerFrame = numChannels * this.PCM_BYTES_PER_SAMPLE;
		const availableBytesPerChunk = this.CHUNK_SIZE_BYTES - this.WAV_HEADER_SIZE;
		const maxSamplesPerChunk = Math.max(
			1,
			Math.floor(availableBytesPerChunk / bytesPerFrame),
		);
		const channelData = Array.from({ length: numChannels }, (_, channelIndex) =>
			audioBuffer.getChannelData(channelIndex),
		);
		const files: File[] = [];
		let chunkIndex = 0;

		for (
			let startSample = 0;
			startSample < audioBuffer.length;
			startSample += maxSamplesPerChunk
		) {
			const endSample = Math.min(
				audioBuffer.length,
				startSample + maxSamplesPerChunk,
			);
			const wavBuffer = this.renderWavBuffer(
				channelData,
				audioBuffer.sampleRate,
				startSample,
				endSample,
			);
			files.push(
				new File([wavBuffer], `${basename}.part${chunkIndex}.wav`, {
					type: "audio/wav",
				}),
			);
			chunkIndex++;
		}

		return files;
	}

	private renderWavBuffer(
		channelData: Float32Array[],
		sampleRate: number,
		startSample: number,
		endSample: number,
	): ArrayBuffer {
		const numChannels = channelData.length;
		const sampleCount = Math.max(0, endSample - startSample);
		const blockAlign = numChannels * this.PCM_BYTES_PER_SAMPLE;
		const buffer = new ArrayBuffer(
			this.WAV_HEADER_SIZE + sampleCount * blockAlign,
		);
		const view = new DataView(buffer);
		this.writeWavHeader(view, sampleRate, numChannels, sampleCount);
		let offset = this.WAV_HEADER_SIZE;

		for (let i = 0; i < sampleCount; i++) {
			for (let channel = 0; channel < numChannels; channel++) {
				const sample = channelData[channel][startSample + i] ?? 0;
				const clamped = Math.max(-1, Math.min(1, sample));
				const intSample =
					clamped < 0
						? clamped * 0x8000
						: clamped * 0x7fff;
				view.setInt16(offset, Math.round(intSample), true);
				offset += this.PCM_BYTES_PER_SAMPLE;
			}
		}

		return buffer;
	}

	private writeWavHeader(
		view: DataView,
		sampleRate: number,
		numChannels: number,
		sampleCount: number,
	): void {
		const blockAlign = numChannels * this.PCM_BYTES_PER_SAMPLE;
		const byteRate = sampleRate * blockAlign;
		const dataSize = sampleCount * blockAlign;
		this.writeString(view, 0, "RIFF");
		view.setUint32(4, 36 + dataSize, true);
		this.writeString(view, 8, "WAVE");
		this.writeString(view, 12, "fmt ");
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, numChannels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, byteRate, true);
		view.setUint16(32, blockAlign, true);
		view.setUint16(34, this.PCM_BYTES_PER_SAMPLE * 8, true);
		this.writeString(view, 36, "data");
		view.setUint32(40, dataSize, true);
	}

	private writeString(view: DataView, offset: number, str: string): void {
		for (let i = 0; i < str.length; i++) {
			view.setUint8(offset + i, str.charCodeAt(i));
		}
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
	): Promise<string> {
		const client = await this.getClient();
		const transcriptions: string[] = new Array(files.length);
		let completedChunks = 0;
		let nextIndex = 0;

		const updateProgress = () => {
			const progress = ((completedChunks / files.length) * 100).toFixed(1);
			updateNotice(
				`Transcribing... ${completedChunks}/${files.length} chunks completed (${progress}%)`,
			);
		};

		updateProgress();

		const worker = async () => {
			while (true) {
				const index = nextIndex++;
				if (index >= files.length) return;
				const file = files[index];

				let retries = 0;
				while (retries < this.MAX_RETRIES) {
					try {
						const result = await client.audio.transcriptions.create({
							model: "whisper-1",
							file,
						});
						transcriptions[index] = result.text;
						completedChunks++;
						updateProgress();
						break;
					} catch (error) {
						retries++;
						if (retries >= this.MAX_RETRIES) {
							console.error(
								`Failed to transcribe chunk ${index} after ${this.MAX_RETRIES} attempts:`,
								error,
							);
							transcriptions[index] = `[Error transcribing chunk ${index}]`;
							completedChunks++;
							updateProgress();
						} else {
							await new Promise((resolve) =>
								setTimeout(resolve, 1000 * retries),
							);
						}
					}
				}
			}
		};

		const workerCount = Math.min(
			this.MAX_CONCURRENT_CHUNK_TRANSCRIPTIONS,
			files.length,
		);
		const workers = Array.from({ length: workerCount }, () => worker());

		await Promise.all(workers);

		return transcriptions.join(" ");
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

		// Ensure the directory exists (create nested folders recursively)
		const directory = transcriptPath.substring(
			0,
			transcriptPath.lastIndexOf("/"),
		);
		if (directory) {
			const parts = directory.split("/");
			let current = "";
			for (const part of parts) {
				current = current ? `${current}/${part}` : part;
				if (!vault.getAbstractFileByPath(current)) {
					await vault.createFolder(current);
				}
			}
		}

		const file = vault.getAbstractFileByPath(transcriptPath);

		if (!file) {
			const newFile = await vault.create(transcriptPath, transcriptContent);
			await this.plugin.app.workspace.getLeaf().openFile(newFile);
		} else if (file instanceof TFile) {
			// File already exists - open it without overwriting
			await this.plugin.app.workspace.getLeaf().openFile(file);
		} else {
			throw new Error("Expected a file but found a folder at transcript path.");
		}
	}

	private async getClient(): Promise<OpenAI> {
		const apiKey = this.plugin.settings.openAIApiKey?.trim();
		if (!apiKey) {
			throw new Error("Missing OpenAI API key");
		}

		if (this.client && this.cachedApiKey === apiKey) {
			return this.client;
		}

		const { OpenAI } = await import("openai");
		this.client = new OpenAI({
			apiKey,
			dangerouslyAllowBrowser: true,
		});
		this.cachedApiKey = apiKey;

		return this.client;
	}
}
