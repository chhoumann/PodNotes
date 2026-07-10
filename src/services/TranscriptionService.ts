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
	let interval: number | null = null;
	let hideTimeout: number | null = null;
	let disposed = false;
	const notice = new Notice(initialMessage, 0);

	function formatMsg(message: string): string {
		return `${heading} (${getTime()}):\n\n${message}`;
	}

	function update(message: string) {
		if (disposed) return;
		currentMessage = message;
		notice.setMessage(formatMsg(currentMessage));
	}

	interval = window.setInterval(() => {
		notice.setMessage(formatMsg(currentMessage));
	}, 1000);

	function getTime(): string {
		return formatTime(stopTime ? stopTime - startTime : Date.now() - startTime);
	}

	function stop() {
		if (interval === null) return;
		stopTime = Date.now();
		window.clearInterval(interval);
		interval = null;
	}

	function scheduleHide(delayMs: number, onHide: () => void) {
		if (disposed) return;
		if (hideTimeout !== null) window.clearTimeout(hideTimeout);
		hideTimeout = window.setTimeout(() => {
			hideTimeout = null;
			if (disposed) return;
			disposed = true;
			notice.hide();
			onHide();
		}, delayMs);
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		stop();
		if (hideTimeout !== null) {
			window.clearTimeout(hideTimeout);
			hideTimeout = null;
		}
		notice.hide();
	}

	return {
		update,
		stop,
		scheduleHide,
		dispose,
	};
}

function formatTime(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	return `${hours.toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

// A chunk that exhausts its retries leaves this placeholder in its transcript
// slot; the pattern matches it so buildTranscriptBody can tell real speech apart
// from a body made only of error markers. Keep the builder and matcher in sync.
function chunkErrorPlaceholder(index: number): string {
	return `[Error transcribing chunk ${index}]`;
}
const CHUNK_ERROR_PLACEHOLDER_PATTERN = /\[Error transcribing chunk \d+\]/g;

export class TranscriptionService {
	private plugin: PodNotes;
	private client: OpenAI | null = null;
	private cachedApiKey: string | null = null;
	private disposed = false;
	private readonly lifetimeAbortController = new AbortController();
	private readonly activeNotices = new Set<ReturnType<typeof TimerNotice>>();
	private MAX_RETRIES = 3;
	private readonly MAX_CONCURRENT_TRANSCRIPTIONS = 2;
	private readonly MAX_CONCURRENT_CHUNK_TRANSCRIPTIONS = 3;
	private pendingEpisodes: Episode[] = [];
	private activeTranscriptions = new Set<string>();

	constructor(
		plugin: PodNotes,
		private readonly loadOpenAI: () => Promise<Pick<typeof import("openai"), "OpenAI">> = () =>
			import("openai"),
	) {
		this.plugin = plugin;
	}

	async transcribeCurrentEpisode(): Promise<void> {
		if (this.disposed) return;
		if (
			!requiredTranscriptionKeyPresent(this.plugin.settings, (kind) =>
				this.plugin.credentials.has(this.plugin.settings, kind),
			)
		) {
			const diarization = this.plugin.settings.transcript.diarization;
			const needsDeepgram = diarization?.enabled && diarization.provider === "deepgram";
			const kind = needsDeepgram ? "deepgram" : "openai";
			const unavailableOnDevice =
				this.plugin.credentials.status(this.plugin.settings, kind) === "missing";
			new Notice(
				unavailableOnDevice
					? `The selected ${needsDeepgram ? "Deepgram" : "OpenAI"} API key is not available on this device. Select or create it in the transcript settings.`
					: needsDeepgram
						? "Select or create a Deepgram API key in the transcript settings on this device."
						: "Select or create an OpenAI API key in the transcript settings on this device.",
			);
			return;
		}

		const currentEpisode = this.plugin.api.podcast;
		if (!currentEpisode) {
			new Notice("No episode is currently playing.");
			return;
		}

		const transcriptPath = this.getTranscriptPath(currentEpisode);
		const existingFile = this.plugin.app.vault.getAbstractFileByPath(transcriptPath);
		if (existingFile instanceof TFile) {
			new Notice(`You've already transcribed this episode - found ${transcriptPath}.`);
			return;
		}

		const episodeKey = this.getEpisodeKey(currentEpisode);
		const isAlreadyQueued =
			this.pendingEpisodes.some((episode) => this.getEpisodeKey(episode) === episodeKey) ||
			this.activeTranscriptions.has(episodeKey);

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
		if (this.disposed) {
			this.pendingEpisodes = [];
			return;
		}
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
				if (!this.disposed) this.drainQueue();
			});
		}
	}

	private getEpisodeKey(episode: Episode): string {
		return `${episode.podcastName}:${episode.title}`;
	}

	private async transcribeEpisode(episode: Episode): Promise<void> {
		this.assertActive();
		const notice = TimerNotice(`Transcription: ${episode.title}`, "Preparing to transcribe...");
		this.activeNotices.add(notice);
		const updateNotice = (message: string) => {
			if (!this.disposed) notice.update(message);
		};

		try {
			const transcriptPath = this.getTranscriptPath(episode);
			const existingFile = this.plugin.app.vault.getAbstractFileByPath(transcriptPath);
			if (existingFile instanceof TFile) {
				notice.stop();
				updateNotice(`Transcript already exists - skipped (${transcriptPath}).`);
				return;
			}

			updateNotice("Fetching episode audio...");
			const {
				buffer: fileBuffer,
				extension: fileExtension,
				basename,
			} = await this.waitForLifecycle(getEpisodeAudioBuffer(episode));
			this.assertActive();
			const mimeType = getMimeType(fileExtension);

			const { body: transcriptBody, warning } = await this.buildTranscriptBody(
				{
					buffer: fileBuffer,
					mimeType,
					extension: fileExtension,
					basename,
				},
				updateNotice,
			);
			this.assertActive();

			updateNotice("Saving transcription...");
			await this.saveTranscription(episode, transcriptBody);
			this.assertActive();

			notice.stop();
			updateNotice(warning ?? "Transcription completed and saved.");
		} catch (error) {
			if (this.disposed || this.lifetimeAbortController.signal.aborted) return;
			console.error("Transcription error:", error);
			const message = error instanceof Error ? error.message : String(error);
			notice.stop();
			updateNotice(`Transcription failed: ${message}`);
		} finally {
			notice.stop();
			if (this.disposed) {
				notice.dispose();
				this.activeNotices.delete(notice);
			} else {
				notice.scheduleHide(5000, () => this.activeNotices.delete(notice));
			}
		}
	}

	/**
	 * Produce the transcript body that fills the template's `{{transcript}}` tag.
	 * Plain Whisper returns one run-on block, so it is reflowed after sentence
	 * periods for readability; diarization returns speaker-labeled turns already
	 * separated into paragraphs, so it is rendered as-is. Either path yielding no
	 * speech is treated as a failure rather than writing an empty transcript (empty
	 * Whisper chunks join to whitespace, so the body is trimmed before the check).
	 *
	 * A chunk that exhausts its retries leaves an `[Error transcribing chunk N]`
	 * placeholder in its slot. If stripping those placeholders leaves no real text -
	 * every chunk failed, or the only successes were empty - we throw, so no file is
	 * written and the episode stays retryable instead of saving a "transcript" made
	 * only of error markers that the existence check would then refuse to re-run
	 * (mirrors the diarization provider's all-chunks-failed contract). When some
	 * chunks fail but real speech remains we keep the otherwise-good transcript and
	 * return a `warning` so the run is reported as partial, not a clean success.
	 */
	private async buildTranscriptBody(
		audio: DiarizationAudio,
		updateNotice: (message: string) => void,
	): Promise<{ body: string; warning?: string }> {
		const diarization = this.plugin.settings.transcript.diarization;

		if (diarization?.enabled) {
			const segments = await this.diarize(audio, diarization.provider, updateNotice);
			this.assertActive();
			if (segments.length === 0) {
				throw new Error("Diarization returned no speech segments.");
			}
			return {
				body: renderDiarizedTranscript(segments, diarization.speakerTemplate),
			};
		}

		updateNotice("Creating audio chunks...");
		const files = await createChunkFiles(audio);
		this.assertActive();
		updateNotice("Starting transcription...");
		const { text, failedChunks } = await this.transcribeChunks(files, updateNotice);
		this.assertActive();

		// Strip the error placeholders (and trim) to see whether ANY real speech was
		// transcribed. Nothing real means every chunk failed or the only successes
		// were empty - either way there is no usable transcript, so throw instead of
		// saving a body of pure error markers (empty chunks join to " ", not "").
		const realText = text.replace(CHUNK_ERROR_PLACEHOLDER_PATTERN, " ").trim();
		if (realText.length === 0) {
			throw new Error(
				failedChunks > 0
					? `Transcription failed: all ${files.length} audio chunk(s) failed or returned no text.`
					: "Transcription returned no text.",
			);
		}

		// Reflow the full body (placeholders kept inline so the user can see which
		// chunks failed) after sentence periods for readability.
		const body = text.trim().replace(/\.\s+/g, ".\n\n");

		const warning =
			failedChunks > 0
				? `Transcription saved, but ${failedChunks} of ${files.length} chunk(s) failed - look for [Error transcribing chunk N] markers and re-run after deleting the note to retry.`
				: undefined;
		return { body, warning };
	}

	/** Route the episode audio to the configured diarization provider (#168). */
	private async diarize(
		audio: DiarizationAudio,
		provider: DiarizationProviderId,
		updateNotice: (message: string) => void,
	): Promise<DiarizedSegment[]> {
		this.assertActive();
		if (provider === "deepgram") {
			const apiKey = this.plugin.credentials.get(this.plugin.settings, "deepgram");
			if (!apiKey) {
				throw new Error("Missing Deepgram API key on this device.");
			}
			// Deepgram ingests the whole file in one request, so it needs no
			// chunking — which is exactly why its speaker labels stay consistent
			// across the entire episode.
			const segments = await this.waitForLifecycle(
				diarizeWithDeepgram({
					audio,
					apiKey,
					onProgress: updateNotice,
					signal: this.lifetimeAbortController.signal,
				}),
			);
			this.assertActive();
			return segments;
		}

		// OpenAI diarization shares Whisper's ~20 MB chunk limit (a conservative
		// margin under OpenAI's 25 MB request cap), so reuse the same chunking.
		// Speaker labels can differ across chunks on a long episode.
		updateNotice("Creating audio chunks...");
		const chunkFiles = await createChunkFiles(audio);
		this.assertActive();
		const segments = await diarizeWithOpenAI({
			getClient: () => this.getClient(),
			chunkFiles,
			maxRetries: this.MAX_RETRIES,
			onProgress: updateNotice,
			signal: this.lifetimeAbortController.signal,
		});
		this.assertActive();
		return segments;
	}

	private async transcribeChunks(
		files: File[],
		updateNotice: (message: string) => void,
	): Promise<{ text: string; failedChunks: number }> {
		const client = await this.getClient();
		this.assertActive();
		const transcriptions: string[] = Array.from({ length: files.length });
		let completedChunks = 0;
		let failedChunks = 0;
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
				this.assertActive();
				const index = nextIndex++;
				if (index >= files.length) return;
				const file = files[index];

				let retries = 0;
				while (retries < this.MAX_RETRIES) {
					this.assertActive();
					try {
						const result = await client.audio.transcriptions.create(
							{
								model: "whisper-1",
								file,
							},
							{ signal: this.lifetimeAbortController.signal },
						);
						this.assertActive();
						transcriptions[index] = result.text;
						completedChunks++;
						updateProgress();
						break;
					} catch (error) {
						this.assertActive();
						retries++;
						if (retries >= this.MAX_RETRIES) {
							console.error(
								`Failed to transcribe chunk ${index} after ${this.MAX_RETRIES} attempts:`,
								error,
							);
							transcriptions[index] = chunkErrorPlaceholder(index);
							failedChunks++;
							completedChunks++;
							updateProgress();
						} else {
							await this.waitForRetry(1000 * retries);
						}
					}
				}
			}
		};

		const workerCount = Math.min(this.MAX_CONCURRENT_CHUNK_TRANSCRIPTIONS, files.length);
		const workers = Array.from({ length: workerCount }, () => worker());

		await Promise.all(workers);
		this.assertActive();

		return { text: transcriptions.join(" "), failedChunks };
	}

	private waitForRetry(delayMs: number): Promise<void> {
		this.assertActive();
		const signal = this.lifetimeAbortController.signal;

		return new Promise((resolve, reject) => {
			const timeout = window.setTimeout(() => {
				signal.removeEventListener("abort", onAbort);
				resolve();
			}, delayMs);
			const onAbort = () => {
				window.clearTimeout(timeout);
				signal.removeEventListener("abort", onAbort);
				reject(this.getAbortReason());
			};

			signal.addEventListener("abort", onAbort, { once: true });
			if (signal.aborted) onAbort();
		});
	}

	private waitForLifecycle<T>(operation: Promise<T>): Promise<T> {
		this.assertActive();
		const signal = this.lifetimeAbortController.signal;

		return new Promise((resolve, reject) => {
			let settled = false;
			const cleanup = () => signal.removeEventListener("abort", onAbort);
			const onAbort = () => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(this.getAbortReason());
			};

			signal.addEventListener("abort", onAbort, { once: true });
			void operation.then(
				(value) => {
					if (settled) return;
					if (signal.aborted) {
						onAbort();
						return;
					}
					settled = true;
					cleanup();
					resolve(value);
				},
				(error) => {
					if (settled) return;
					if (signal.aborted) {
						onAbort();
						return;
					}
					settled = true;
					cleanup();
					reject(error);
				},
			);
			if (signal.aborted) onAbort();
		});
	}

	/**
	 * The on-disk path of an episode's transcript note, capped so a long title
	 * can't trip ENAMETOOLONG (#22). Used for the existence checks and the write
	 * alike so they always agree on the same path. The extension comes from the
	 * configured template (not forced to ".md") so a custom transcript path keeps
	 * the user's chosen suffix.
	 */
	private getTranscriptPath(episode: Episode): string {
		return getEpisodeTranscriptPath(episode, this.plugin.settings.transcript.path);
	}

	private async saveTranscription(episode: Episode, transcriptBody: string): Promise<void> {
		this.assertActive();
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
		const directory = transcriptPath.substring(0, transcriptPath.lastIndexOf("/"));
		await ensureFolderExists(directory, vault, () => this.assertActive());
		this.assertActive();

		const file = vault.getAbstractFileByPath(transcriptPath);

		if (!file) {
			this.assertActive();
			const newFile = await vault.create(transcriptPath, transcriptContent);
			this.assertActive();
			await this.plugin.app.workspace.getLeaf().openFile(newFile);
		} else if (file instanceof TFile) {
			// File already exists - open it without overwriting
			this.assertActive();
			await this.plugin.app.workspace.getLeaf().openFile(file);
		} else {
			throw new Error("Expected a file but found a folder at transcript path.");
		}
	}

	private async getClient(): Promise<OpenAI> {
		this.assertActive();
		const apiKey = this.plugin.credentials.get(this.plugin.settings, "openai");
		if (!apiKey) {
			throw new Error("Missing OpenAI API key on this device");
		}

		if (this.client && this.cachedApiKey === apiKey) {
			return this.client;
		}

		const { OpenAI } = await this.loadOpenAI();
		this.assertActive();
		this.client = new OpenAI({
			apiKey,
			dangerouslyAllowBrowser: true,
		});
		this.cachedApiKey = apiKey;

		return this.client;
	}

	/** Drop the client and its credential material when the plugin unloads. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.lifetimeAbortController.abort(
			new DOMException("PodNotes was unloaded during transcription.", "AbortError"),
		);
		this.pendingEpisodes = [];
		for (const notice of this.activeNotices) {
			notice.dispose();
		}
		this.activeNotices.clear();
		this.clearCredentialCache();
	}

	clearCredentialCache(): void {
		this.client = null;
		this.cachedApiKey = null;
	}

	private assertActive(): void {
		if (this.disposed || this.lifetimeAbortController.signal.aborted) {
			throw this.getAbortReason();
		}
	}

	private getAbortReason(): unknown {
		return (
			this.lifetimeAbortController.signal.reason ??
			new DOMException("PodNotes was unloaded during transcription.", "AbortError")
		);
	}
}
