import { Notice, TFile, type Vault } from "obsidian";
import type PodNotes from "../main";
import { FilePathTemplateEngine, TranscriptTemplateEngine } from "../TemplateEngine";
import { enforceMaxPathLength, lastSegmentExtension } from "../utility/enforceMaxPathLength";
import { ensureFolderExists } from "../utility/ensureFolderExists";
import { toError } from "../utility/toError";
import type { Episode } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { openNote } from "src/ui/openNote";
import { TimerNotice } from "src/ui/TimerNotice";
import {
	fetchPublishedTranscript,
	findPublishedTranscript,
	type ParsedTranscript,
	type PublishedTranscript,
	PublishedTranscriptError,
	renderTranscriptBody,
	timestampStyle,
} from "./publishedTranscript";
import { refreshModels, transcribe, transcriptionChoice } from "./transcription";

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

const MAX_CONCURRENT_TRANSCRIPTIONS = 2;

/** What the user reads when the settings name a provider this version does not have. */
function unknownProvider(storedId: string): string {
	return `This version of PodNotes cannot transcribe with ${storedId}. Update PodNotes, or choose another provider in the transcript settings.`;
}

function queueKey(episode: Episode): string {
	return `${episode.podcastName}:${episode.title}`;
}

interface TranscriptionJob {
	readonly episode: Episode;
	readonly source:
		| { readonly kind: "published"; readonly transcript: PublishedTranscript }
		| { readonly kind: "audio" };
}

interface Outcome {
	/** Fills the template's `{{transcript}}` tag. */
	readonly body: string;
	/** What the notice says once the note is saved. */
	readonly completion: string;
	/** The note is not all that was asked for, and `completion` says why. */
	readonly warns: boolean;
}

export class TranscriptionService {
	private plugin: PodNotes;
	private disposed = false;
	private readonly lifetimeAbortController = new AbortController();
	private readonly signal = this.lifetimeAbortController.signal;
	private readonly activeNotices = new Set<ReturnType<typeof TimerNotice>>();
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
			if (this.disposed || this.signal.aborted) return;
			throw error;
		}

		if (transcript) {
			this.enqueue({ episode, source: { kind: "published", transcript } });
		} else if (!paid) {
			new Notice("No published transcript was found for this episode.");
		} else {
			const refusal = this.refusal();
			if (refusal) new Notice(refusal);
			else this.enqueue({ episode, source: { kind: "audio" } });
		}
	}

	transcribeCurrentEpisodeFromAudio(): void {
		if (this.disposed) return;
		const refusal = this.refusal();
		if (refusal) {
			new Notice(refusal);
			return;
		}
		const episode = this.plugin.api.podcast;
		if (!episode) {
			new Notice("No episode is currently playing.");
			return;
		}
		this.enqueue({ episode, source: { kind: "audio" } });
	}

	/** Why audio cannot go to the chosen provider from this device, or undefined when it can. */
	private refusal(): string | undefined {
		const { settings, credentials } = this.plugin;
		const { provider, label } = transcriptionChoice(settings);
		if (provider === undefined) return unknownProvider(label);
		if (credentials.has(settings, provider)) return undefined;
		return credentials.status(settings, provider) === "missing"
			? `The selected ${label} API key is not available on this device. Select or create it in the transcript settings.`
			: `Select or create ${/^[AEIOU]/.test(label) ? "an" : "a"} ${label} API key in the transcript settings on this device.`;
	}

	private enqueue(job: TranscriptionJob): void {
		const existing = transcriptNote(this.plugin.app.vault, this.plugin.settings, job.episode);
		if (existing) {
			new Notice(`You've already transcribed this episode - found ${existing.path}.`);
			return;
		}

		const episodeKey = queueKey(job.episode);
		const isAlreadyQueued =
			this.pendingJobs.some((pending) => queueKey(pending.episode) === episodeKey) ||
			this.activeTranscriptions.has(episodeKey);

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
			this.activeTranscriptions.size < MAX_CONCURRENT_TRANSCRIPTIONS &&
			this.pendingJobs.length > 0
		) {
			const job = this.pendingJobs.shift();
			if (!job) {
				return;
			}

			const episodeKey = queueKey(job.episode);
			this.activeTranscriptions.add(episodeKey);

			void this.transcribeEpisode(job).finally(() => {
				this.activeTranscriptions.delete(episodeKey);
				if (!this.disposed) this.drainQueue();
			});
		}
	}

	private async transcribeEpisode({ episode, source }: TranscriptionJob): Promise<void> {
		this.assertActive();
		const notice = TimerNotice(`Transcription: ${episode.title}`, "Preparing to transcribe...");
		this.activeNotices.add(notice);
		const updateNotice = (message: string) => {
			if (!this.disposed) notice.update(message);
		};
		// A failure, or a note saved with a warning, asks for an action, so it stays until clicked.
		let lasting = true;

		try {
			const existing = transcriptNote(this.plugin.app.vault, this.plugin.settings, episode);
			if (existing) {
				notice.stop();
				lasting = false;
				updateNotice(`Transcript already exists - skipped (${existing.path}).`);
				return;
			}

			const outcome =
				source.kind === "published"
					? await this.readPublishedTranscript(episode, source.transcript, updateNotice)
					: await this.transcribeAudio(episode, updateNotice);
			this.assertActive();

			updateNotice("Saving transcription...");
			await this.saveTranscription(episode, outcome.body);
			this.assertActive();

			notice.stop();
			lasting = outcome.warns;
			updateNotice(outcome.completion);
		} catch (error) {
			if (this.disposed || this.signal.aborted) return;
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
			} else if (!lasting) {
				notice.scheduleHide(5000, () => this.activeNotices.delete(notice));
			}
		}
	}

	private async readPublishedTranscript(
		episode: Episode,
		transcript: PublishedTranscript,
		updateNotice: (message: string) => void,
	): Promise<Outcome> {
		updateNotice("Fetching the published transcript...");
		const parsed = await this.waitForLifecycle(
			fetchPublishedTranscript(this.plugin.feeds, episode, transcript, this.signal),
		);
		return {
			body: this.renderBody(episode, parsed),
			completion: "Saved the transcript the feed publishes.",
			warns: false,
		};
	}

	private async transcribeAudio(
		episode: Episode,
		updateNotice: (message: string) => void,
	): Promise<Outcome> {
		const { settings, credentials, feeds } = this.plugin;
		await this.waitForLifecycle(refreshModels(settings.transcript.provider));
		const choice = transcriptionChoice(settings);
		if (choice.provider === undefined) throw new Error(unknownProvider(choice.label));
		const apiKey = credentials.get(settings, choice.provider);
		if (!apiKey) throw new Error(`Missing ${choice.label} API key on this device.`);
		const { content, warnings } = await this.waitForLifecycle(
			transcribe({
				choice,
				apiKey,
				episode,
				feeds,
				signal: this.signal,
				onProgress: updateNotice,
			}),
		);
		return {
			body: this.renderBody(episode, content),
			completion: warnings.join(" ") || "Transcription completed and saved.",
			warns: warnings.length > 0,
		};
	}

	private renderBody(episode: Episode, transcript: ParsedTranscript): string {
		const { timestamp, transcript: settings } = this.plugin.settings;
		return renderTranscriptBody(transcript, {
			episode,
			speakerTemplate: settings.diarization.speakerTemplate,
			timestamp: timestampStyle(timestamp.template),
		});
	}

	private publishedTranscriptFailure(error: PublishedTranscriptError): string {
		if (this.refusal()) return error.message;
		const { label } = transcriptionChoice(this.plugin.settings);
		return `${error.message} Run "${TRANSCRIBE_FROM_AUDIO_COMMAND}" to transcribe it with ${label} instead, which uses your API credit.`;
	}

	private waitForLifecycle<T>(operation: Promise<T>): Promise<T> {
		this.assertActive();
		const { signal } = this;

		return new Promise((resolve, reject) => {
			const onAbort = () =>
				reject(toError(this.getAbortReason(), "PodNotes transcription was aborted."));
			signal.addEventListener("abort", onAbort, { once: true });
			void operation
				.then(resolve, (error: unknown) =>
					reject(toError(error, "PodNotes transcription failed.")),
				)
				.finally(() => signal.removeEventListener("abort", onAbort));
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
		if (this.disposed || this.signal.aborted) {
			throw this.getAbortReason();
		}
	}

	private getAbortReason(): unknown {
		return (
			this.signal.reason ??
			new DOMException("PodNotes was unloaded during transcription.", "AbortError")
		);
	}
}
