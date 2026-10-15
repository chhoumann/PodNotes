import { Notice, TFile, type Vault } from "obsidian";
import type PodNotes from "../main";
import { getEpisodeAudioBuffer } from "../downloadEpisode";
import { FilePathTemplateEngine, TranscriptTemplateEngine } from "../TemplateEngine";
import { enforceMaxPathLength, lastSegmentExtension } from "../utility/enforceMaxPathLength";
import { ensureFolderExists } from "../utility/ensureFolderExists";
import { toError } from "../utility/toError";
import type { Episode } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { openNote } from "src/ui/openNote";
import { TimerNotice } from "src/ui/TimerNotice";
import { createChunkFiles, getMimeType } from "./audioChunker";
import { createTranscription, retryDelayMs } from "./openaiTranscription";
import {
	type DiarizationAudio,
	type DiarizationProviderId,
	type DiarizedSegment,
	diarizeWithDeepgram,
	diarizeWithOpenAI,
	renderDiarizedTranscript,
	requiredTranscriptionKeyPresent,
} from "./diarization";
import {
	fetchPublishedTranscript,
	findPublishedTranscript,
	type PublishedTranscript,
	PublishedTranscriptError,
	renderTranscriptBody,
	timestampStyle,
} from "./publishedTranscript";

export const TRANSCRIBE_FROM_AUDIO_COMMAND = "Transcribe current episode from audio";

type TranscriptSettings = Pick<IPodNotesSettings, "transcript">;

/**
 * Where an episode's transcript note goes, capped so a long title can't trip ENAMETOOLONG.
 * The extension comes from the transcript path, so a custom one is kept.
 */
function transcriptPath(settings: TranscriptSettings, episode: Episode): string {
	const rendered = FilePathTemplateEngine(settings.transcript.path, episode);
	return enforceMaxPathLength(rendered, lastSegmentExtension(rendered));
}

/** The episode's transcript note, if one is at the transcript path. */
export function transcriptNote(
	vault: Vault,
	settings: TranscriptSettings,
	episode: Episode,
): TFile | null {
	return vault.getFileByPath(transcriptPath(settings, episode));
}

// A chunk that exhausts its retries leaves this placeholder in its transcript
// slot; the pattern matches it so buildTranscriptBody can tell real speech apart
// from a body made only of error markers. Keep the builder and matcher in sync.
function chunkErrorPlaceholder(index: number): string {
	return `[Error transcribing chunk ${index}]`;
}
const CHUNK_ERROR_PLACEHOLDER_PATTERN = /\[Error transcribing chunk \d+\]/g;

interface TranscriptionJob {
	readonly episode: Episode;
	readonly source:
		| { readonly kind: "published"; readonly transcript: PublishedTranscript }
		| { readonly kind: "audio" };
}

export class TranscriptionService {
	private plugin: PodNotes;
	private disposed = false;
	private readonly lifetimeAbortController = new AbortController();
	private readonly activeNotices = new Set<ReturnType<typeof TimerNotice>>();
	private MAX_RETRIES = 3;
	private readonly MAX_CONCURRENT_TRANSCRIPTIONS = 2;
	private readonly MAX_CONCURRENT_CHUNK_TRANSCRIPTIONS = 3;
	private pendingJobs: TranscriptionJob[] = [];
	private activeTranscriptions = new Set<string>();

	constructor(plugin: PodNotes) {
		this.plugin = plugin;
	}

	/** `paid: false` stops at a Notice when no published transcript is found, instead of sending the audio to the user's provider. */
	async transcribeCurrentEpisode({ paid = true } = {}): Promise<void> {
		if (this.disposed) return;
		const episode = this.plugin.api.podcast;
		if (!episode) {
			new Notice("No episode is currently playing.");
			return;
		}

		let transcript: PublishedTranscript | undefined;
		try {
			transcript = await this.waitForLifecycle(
				findPublishedTranscript(this.plugin.feeds, episode),
			);
		} catch (error) {
			if (this.disposed || this.lifetimeAbortController.signal.aborted) return;
			throw error;
		}

		if (transcript) {
			this.enqueue({ episode, source: { kind: "published", transcript } });
		} else if (!paid) {
			new Notice("No published transcript was found for this episode.");
		} else if (this.hasRequiredKey()) {
			this.enqueue({ episode, source: { kind: "audio" } });
		} else {
			this.noticeMissingKey();
		}
	}

	transcribeCurrentEpisodeFromAudio(): void {
		if (this.disposed) return;
		if (!this.hasRequiredKey()) {
			this.noticeMissingKey();
			return;
		}
		const episode = this.plugin.api.podcast;
		if (!episode) {
			new Notice("No episode is currently playing.");
			return;
		}
		this.enqueue({ episode, source: { kind: "audio" } });
	}

	private hasRequiredKey(): boolean {
		return requiredTranscriptionKeyPresent(this.plugin.settings, (kind) =>
			this.plugin.credentials.has(this.plugin.settings, kind),
		);
	}

	private needsDeepgram(): boolean {
		const diarization = this.plugin.settings.transcript.diarization;
		return Boolean(diarization?.enabled && diarization.provider === "deepgram");
	}

	private noticeMissingKey(): void {
		const needsDeepgram = this.needsDeepgram();
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
	}

	private enqueue(job: TranscriptionJob): void {
		const existing = transcriptNote(this.plugin.app.vault, this.plugin.settings, job.episode);
		if (existing) {
			new Notice(`You've already transcribed this episode - found ${existing.path}.`);
			return;
		}

		const episodeKey = this.getEpisodeKey(job.episode);
		const isAlreadyQueued =
			this.pendingJobs.some(
				(pending) => this.getEpisodeKey(pending.episode) === episodeKey,
			) || this.activeTranscriptions.has(episodeKey);

		if (isAlreadyQueued) {
			new Notice("This episode is already queued or transcribing.");
			return;
		}

		this.pendingJobs.push(job);
		new Notice(`Queued "${job.episode.title}" for transcription. It will start automatically.`);
		this.drainQueue();
	}

	private drainQueue(): void {
		if (this.disposed) {
			this.pendingJobs = [];
			return;
		}
		while (
			this.activeTranscriptions.size < this.MAX_CONCURRENT_TRANSCRIPTIONS &&
			this.pendingJobs.length > 0
		) {
			const job = this.pendingJobs.shift();
			if (!job) {
				return;
			}

			const episodeKey = this.getEpisodeKey(job.episode);
			this.activeTranscriptions.add(episodeKey);

			void this.transcribeEpisode(job).finally(() => {
				this.activeTranscriptions.delete(episodeKey);
				if (!this.disposed) this.drainQueue();
			});
		}
	}

	private getEpisodeKey(episode: Episode): string {
		return `${episode.podcastName}:${episode.title}`;
	}

	private async transcribeEpisode({ episode, source }: TranscriptionJob): Promise<void> {
		this.assertActive();
		const notice = TimerNotice(`Transcription: ${episode.title}`, "Preparing to transcribe...");
		this.activeNotices.add(notice);
		const updateNotice = (message: string) => {
			if (!this.disposed) notice.update(message);
		};

		try {
			const existing = transcriptNote(this.plugin.app.vault, this.plugin.settings, episode);
			if (existing) {
				notice.stop();
				updateNotice(`Transcript already exists - skipped (${existing.path}).`);
				return;
			}

			const { body, completion } =
				source.kind === "published"
					? await this.readPublishedTranscript(episode, source.transcript, updateNotice)
					: await this.transcribeAudio(episode, updateNotice);
			this.assertActive();

			updateNotice("Saving transcription...");
			await this.saveTranscription(episode, body);
			this.assertActive();

			notice.stop();
			updateNotice(completion);
		} catch (error) {
			if (this.disposed || this.lifetimeAbortController.signal.aborted) return;
			console.error("Transcription error:", error);
			notice.stop();
			updateNotice(
				error instanceof PublishedTranscriptError
					? this.publishedTranscriptFailure(error)
					: `Transcription failed: ${error instanceof Error ? error.message : String(error)}`,
			);
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

	private async readPublishedTranscript(
		episode: Episode,
		transcript: PublishedTranscript,
		updateNotice: (message: string) => void,
	): Promise<{ body: string; completion: string }> {
		updateNotice("Fetching the published transcript...");
		const parsed = await this.waitForLifecycle(
			fetchPublishedTranscript(
				this.plugin.feeds,
				episode,
				transcript,
				this.lifetimeAbortController.signal,
			),
		);
		const { timestamp, transcript: settings } = this.plugin.settings;
		const body = renderTranscriptBody(parsed, {
			episode,
			speakerTemplate: settings.diarization?.speakerTemplate ?? "",
			timestamp: timestampStyle(timestamp.template),
		});
		return { body, completion: "Saved the transcript the feed publishes." };
	}

	private async transcribeAudio(
		episode: Episode,
		updateNotice: (message: string) => void,
	): Promise<{ body: string; completion: string }> {
		updateNotice("Fetching episode audio...");
		const { buffer, extension, basename } = await this.waitForLifecycle(
			getEpisodeAudioBuffer(episode),
		);
		this.assertActive();
		const { body, warning } = await this.buildTranscriptBody(
			{ buffer, mimeType: getMimeType(extension), extension, basename },
			updateNotice,
		);
		return { body, completion: warning ?? "Transcription completed and saved." };
	}

	private publishedTranscriptFailure(error: PublishedTranscriptError): string {
		if (!this.hasRequiredKey()) return error.message;
		const provider = this.needsDeepgram() ? "Deepgram" : "OpenAI";
		return `${error.message} Run "${TRANSCRIBE_FROM_AUDIO_COMMAND}" to transcribe it with ${provider} instead, which uses your API credit.`;
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
			// chunking, which is exactly why its speaker labels stay consistent
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
			apiKey: this.getApiKey(),
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
		const apiKey = this.getApiKey();
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
						const result = await createTranscription(
							apiKey,
							{ model: "whisper-1", file },
							this.lifetimeAbortController.signal,
						);
						this.assertActive();
						const text = (result as { text?: unknown } | null)?.text;
						if (typeof text !== "string") {
							throw new Error("OpenAI returned a transcription without text.");
						}
						transcriptions[index] = text;
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
							await this.waitForRetry(retryDelayMs(error, 1000 * retries));
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
				reject(toError(this.getAbortReason(), "PodNotes transcription was aborted."));
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
				reject(toError(this.getAbortReason(), "PodNotes transcription was aborted."));
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
					reject(toError(error, "PodNotes transcription failed."));
				},
			);
			if (signal.aborted) onAbort();
		});
	}

	private async saveTranscription(episode: Episode, transcriptBody: string): Promise<void> {
		this.assertActive();
		const path = transcriptPath(this.plugin.settings, episode);
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
		const directory = path.substring(0, path.lastIndexOf("/"));
		await ensureFolderExists(directory, vault, () => this.assertActive());
		this.assertActive();

		const file = vault.getAbstractFileByPath(path);

		if (!file) {
			this.assertActive();
			const newFile = await vault.create(path, transcriptContent);
			this.assertActive();
			await openNote(this.plugin.app, newFile);
		} else if (file instanceof TFile) {
			// File already exists - open it without overwriting
			this.assertActive();
			await openNote(this.plugin.app, file);
		} else {
			throw new Error("Expected a file but found a folder at transcript path.");
		}
	}

	private getApiKey(): string {
		this.assertActive();
		const apiKey = this.plugin.credentials.get(this.plugin.settings, "openai");
		if (!apiKey) {
			throw new Error("Missing OpenAI API key on this device");
		}
		return apiKey;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.lifetimeAbortController.abort(
			new DOMException("PodNotes was unloaded during transcription.", "AbortError"),
		);
		this.pendingJobs = [];
		for (const notice of this.activeNotices) {
			notice.dispose();
		}
		this.activeNotices.clear();
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
