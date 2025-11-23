import { Notice, TFile } from "obsidian";
import { OpenAI } from "openai";
import type PodNotes from "../main";
import { downloadEpisode } from "../downloadEpisode";
import {
	FilePathTemplateEngine,
	TranscriptTemplateEngine,
} from "../TemplateEngine";
import type { Episode } from "src/types/Episode";

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

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

			notice.update("Preparing audio for transcription...");
			const fileBuffer = await this.plugin.app.vault.readBinary(podcastFile);
			const fileExtension = podcastFile.extension;
			const mimeType = this.getMimeType(fileExtension);

			const chunks = this.chunkFile(fileBuffer);
			const files = this.createChunkFiles(
				chunks,
				podcastFile.basename,
				fileExtension,
				mimeType,
			);

			notice.update("Starting transcription...");
			const transcription = await this.transcribeChunks(files, notice.update);

			notice.update("Saving transcription...");
			await this.saveTranscription(currentEpisode, transcription);

			notice.stop();
			notice.update("Transcription completed and saved.");
		} catch (error: unknown) {
			console.error("Transcription error:", error);
			notice.update(`Transcription failed: ${getErrorMessage(error)}`);
		} finally {
			this.isTranscribing = false;
			setTimeout(() => notice.hide(), 5000);
		}
	}

	private chunkFile(fileBuffer: ArrayBuffer): ArrayBuffer[] {
		const CHUNK_SIZE_MB = 20;
		const chunkSizeBytes = CHUNK_SIZE_MB * 1024 * 1024; // Convert MB to bytes
		const chunks: ArrayBuffer[] = [];
		for (let i = 0; i < fileBuffer.byteLength; i += chunkSizeBytes) {
			chunks.push(fileBuffer.slice(i, i + chunkSizeBytes));
		}
		return chunks;
	}

	private createChunkFiles(
		chunks: ArrayBuffer[],
		fileName: string,
		fileExtension: string,
		mimeType: string,
	): File[] {
		return chunks.map(
			(chunk, index) =>
				new File([chunk], `${fileName}.part${index}.${fileExtension}`, {
					type: mimeType,
				}),
		);
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
		const transcriptions: string[] = new Array(files.length);
		let completedChunks = 0;

		const updateProgress = () => {
			const progress = ((completedChunks / files.length) * 100).toFixed(1);
			updateNotice(
				`Transcribing... ${completedChunks}/${files.length} chunks completed (${progress}%)`,
			);
		};

		updateProgress();

		await Promise.all(
			files.map(async (file, index) => {
				let retries = 0;
				while (retries < this.MAX_RETRIES) {
					try {
						const result = await this.client.audio.transcriptions.create({
							model: "whisper-1",
							file,
						});
						transcriptions[index] = result.text;
						completedChunks++;
						updateProgress();
						break;
					} catch (error: unknown) {
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
							); // Exponential backoff
						}
					}
				}
			}),
		);

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
