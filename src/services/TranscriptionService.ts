import { Notice, TFile } from "obsidian";
import type { OpenAI } from "openai";
import type PodNotes from "../main";
import { getEpisodeAudioBuffer } from "../downloadEpisode";
import { TranscriptTemplateEngine } from "../TemplateEngine";
import { ensureFolderExists } from "../utility/ensureFolderExists";
import type { Episode } from "src/types/Episode";
import { getEpisodeTranscriptPath } from "src/utility/getEpisodeTranscriptPath";
import { createChunkFiles, getMimeType } from "./audioChunker";
import {
	type DiarizationAudio,
	type DiarizationProviderId,
	type DiarizedSegment,
	diarizeWithDeepgram,
	diarizeWithOpenAI,
	renderDiarizedTranscript,
	requiredTranscriptionKeyPresent,
} from "./diarization";

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

	const interval = window.setInterval(() => {
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
			window.clearInterval(interval);
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
	private readonly MAX_CONCURRENT_TRANSCRIPTIONS = 2;
	private readonly MAX_CONCURRENT_CHUNK_TRANSCRIPTIONS = 3;
	private pendingEpisodes: Episode[] = [];
	private activeTranscriptions = new Set<string>();

	constructor(plugin: PodNotes) {
		this.plugin = plugin;
	}

	async transcribeCurrentEpisode(): Promise<void> {
		if (!requiredTranscriptionKeyPresent(this.plugin.settings)) {
			const diarization = this.plugin.settings.transcript.diarization;
			const needsDeepgram =
				diarization?.enabled && diarization.provider === "deepgram";
			new Notice(
				needsDeepgram
					? "Please add your Deepgram API key in the transcript settings to use Deepgram diarization."
					: "Please add your OpenAI API key in the transcript settings first.",
			);
			return;
		}

		const currentEpisode = this.plugin.api.podcast;
		if (!currentEpisode) {
			new Notice("No episode is currently playing.");
			return;
		}

		const transcriptPath = this.getTranscriptPath(currentEpisode);
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
			const transcriptPath = this.getTranscriptPath(episode);
			const existingFile =
				this.plugin.app.vault.getAbstractFileByPath(transcriptPath);
			if (existingFile instanceof TFile) {
				notice.stop();
				notice.update(
					`Transcript already exists - skipped (${transcriptPath}).`,
				);
				return;
			}

			notice.update("Fetching episode audio...");
			const {
				buffer: fileBuffer,
				extension: fileExtension,
				basename,
			} = await getEpisodeAudioBuffer(episode);
			const mimeType = getMimeType(fileExtension);

			const transcriptBody = await this.buildTranscriptBody(
				{
					buffer: fileBuffer,
					mimeType,
					extension: fileExtension,
					basename,
				},
				notice.update,
			);

			notice.update("Saving transcription...");
			await this.saveTranscription(episode, transcriptBody);

			notice.stop();
			notice.update("Transcription completed and saved.");
		} catch (error) {
			console.error("Transcription error:", error);
			const message = error instanceof Error ? error.message : String(error);
			notice.stop();
			notice.update(`Transcription failed: ${message}`);
		} finally {
			notice.stop();
			window.setTimeout(() => notice.hide(), 5000);
		}
	}

	/**
	 * Produce the transcript body that fills the template's `{{transcript}}` tag.
	 * Plain Whisper returns one run-on block, so it is reflowed after sentence
	 * periods for readability; diarization returns speaker-labeled turns already
	 * separated into paragraphs, so it is rendered as-is. Either path yielding no
	 * speech is treated as a failure rather than writing an empty transcript (empty
	 * Whisper chunks join to whitespace, so the body is trimmed before the check).
	 */
	private async buildTranscriptBody(
		audio: DiarizationAudio,
		updateNotice: (message: string) => void,
	): Promise<string> {
		const diarization = this.plugin.settings.transcript.diarization;

		if (diarization?.enabled) {
			const segments = await this.diarize(
				audio,
				diarization.provider,
				updateNotice,
			);
			if (segments.length === 0) {
				throw new Error("Diarization returned no speech segments.");
			}
			return renderDiarizedTranscript(segments, diarization.speakerTemplate);
		}

		updateNotice("Creating audio chunks...");
		const files = await createChunkFiles(audio);
		updateNotice("Starting transcription...");
		const transcription = await this.transcribeChunks(files, updateNotice);
		// Empty chunks join to " " (not ""), so trim before deciding it is empty.
		const body = transcription.trim().replace(/\.\s+/g, ".\n\n");
		if (body.length === 0) {
			throw new Error("Transcription returned no text.");
		}
		return body;
	}

	/** Route the episode audio to the configured diarization provider (#168). */
	private async diarize(
		audio: DiarizationAudio,
		provider: DiarizationProviderId,
		updateNotice: (message: string) => void,
	): Promise<DiarizedSegment[]> {
		if (provider === "deepgram") {
			const apiKey = this.plugin.settings.diarizationApiKey?.trim();
			if (!apiKey) {
				throw new Error("Missing Deepgram API key for diarization.");
			}
			// Deepgram ingests the whole file in one request, so it needs no
			// chunking — which is exactly why its speaker labels stay consistent
			// across the entire episode.
			return diarizeWithDeepgram({
				audio,
				apiKey,
				onProgress: updateNotice,
			});
		}

		// OpenAI diarization shares Whisper's ~20 MB chunk limit (a conservative
		// margin under OpenAI's 25 MB request cap), so reuse the same chunking.
		// Speaker labels can differ across chunks on a long episode.
		updateNotice("Creating audio chunks...");
		const chunkFiles = await createChunkFiles(audio);
		return diarizeWithOpenAI({
			getClient: () => this.getClient(),
			chunkFiles,
			maxRetries: this.MAX_RETRIES,
			onProgress: updateNotice,
		});
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
								window.setTimeout(resolve, 1000 * retries),
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

	/**
	 * The on-disk path of an episode's transcript note, capped so a long title
	 * can't trip ENAMETOOLONG (#22). Used for the existence checks and the write
	 * alike so they always agree on the same path. The extension comes from the
	 * configured template (not forced to ".md") so a custom transcript path keeps
	 * the user's chosen suffix.
	 */
	private getTranscriptPath(episode: Episode): string {
		return getEpisodeTranscriptPath(
			episode,
			this.plugin.settings.transcript.path,
		);
	}

	private async saveTranscription(
		episode: Episode,
		transcriptBody: string,
	): Promise<void> {
		const transcriptPath = this.getTranscriptPath(episode);
		// transcriptBody is already formatted by buildTranscriptBody (sentence
		// reflow for Whisper, speaker turns for diarization), so it is templated
		// verbatim here.
		const transcriptContent = TranscriptTemplateEngine(
			this.plugin.settings.transcript.template,
			episode,
			transcriptBody,
		);

		const vault = this.plugin.app.vault;

		// Create nested folders recursively. ensureFolderExists tolerates a
		// "Folder already exists" thrown when a case-insensitive lookup misses an
		// existing folder, which the old hand-rolled loop surfaced as a spurious
		// failure (the #87 class of bug).
		const directory = transcriptPath.substring(
			0,
			transcriptPath.lastIndexOf("/"),
		);
		await ensureFolderExists(directory, vault);

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
