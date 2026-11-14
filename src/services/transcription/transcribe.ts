import { getEpisodeAudioBuffer } from "src/downloadEpisode";
import type { FeedRepository } from "src/services/FeedRepository";
import type { ParsedTranscript } from "src/services/publishedTranscript/parse";
import type { Episode } from "src/types/Episode";
import { publicAudioUrl } from "./audioSource";
import { type SameSpeaker, type TranscribedPart, transcriptFromParts } from "./cues";
import { createSender, failure, type FailureKind, TranscriptionError } from "./http";
import type { AudioInput } from "./providers/types";
import { PROVIDERS, type ProviderChoice, providersWithSpeakers } from "./registry";
import { speakerReel } from "./speakers";
import { splitAudio } from "./split";

export interface TranscriptionJob {
	readonly choice: ProviderChoice;
	readonly apiKey: string;
	readonly episode: Episode;
	/** Read to tell whether the provider may be given the episode's address. */
	readonly feeds: Pick<FeedRepository, "load" | "subscribe">;
	readonly signal: AbortSignal;
	readonly onProgress: (message: string) => void;
}

export interface Transcript {
	readonly content: ParsedTranscript;
	/** One sentence each, for a transcript that is not all that was asked for. */
	readonly warnings: readonly string[];
}

/** The failures the next part would meet too, so the job stops instead of uploading the rest. */
const ENDS_THE_JOB: ReadonlySet<FailureKind> = new Set([
	"auth",
	"credits",
	"model-unavailable",
	"privacy",
	"rejected",
]);

/**
 * The episode's transcript from the chosen provider. Rejects with a TranscriptionError,
 * whose message is the sentence the user reads, or with the signal's reason once aborted.
 */
export async function transcribe(job: TranscriptionJob): Promise<Transcript> {
	const { choice, apiKey, episode, signal, onProgress } = job;
	const { model } = choice;
	const provider = PROVIDERS[choice.provider];
	const context = { provider: choice.label, model: model.id, timeoutMs: provider.timeoutMs };
	const send = createSender(provider.failure, context, signal);
	const speakers = choice.speakers && model.speakers;
	const transcribeOne = (audio: AudioInput) =>
		provider.transcribe({ apiKey, model, speakers, audio }, send);
	const progress = `Transcribing with ${choice.label}...`;

	const parts: TranscribedPart[] = [];
	let lastFailure: TranscriptionError | undefined;
	let sameSpeaker: SameSpeaker | undefined;

	const url = model.url ? await publicAudioUrl(episode, job.feeds) : undefined;
	if (url) {
		onProgress(progress);
		try {
			parts.push({ start: 0, transcript: await transcribeOne({ url }) });
		} catch (error) {
			// Only a provider that could not download the address gets the bytes instead.
			if (!(error instanceof TranscriptionError) || error.kind !== "unfetched") throw error;
		}
	}

	if (parts.length === 0) {
		// An aborted job downloads and decodes nothing more. The sender refuses its requests.
		if (signal.aborted) throw signal.reason;
		onProgress("Fetching episode audio...");
		const audio = await getEpisodeAudioBuffer(episode);
		if (signal.aborted) throw signal.reason;
		const files = await splitAudio(audio, {
			maxBytes: model.maxUploadBytes,
			maxSeconds: model.maxSeconds,
		});
		// One part at a time: an upload is held in memory whole, and a failure that ends the
		// job ends it before the next part is sent.
		for (const [index, { file, start }] of files.entries()) {
			onProgress(
				files.length === 1 ? progress : `${progress} part ${index + 1} of ${files.length}`,
			);
			try {
				parts.push({ start, transcript: await transcribeOne({ file }) });
			} catch (error) {
				if (!(error instanceof TranscriptionError) || ENDS_THE_JOB.has(error.kind)) {
					throw error;
				}
				lastFailure = error;
				parts.push({ start });
			}
		}

		const reel =
			speakers && model.mergeSpeakers && files.length > 1
				? speakerReel(parts, audio)
				: undefined;
		if (reel) {
			onProgress(`${progress} matching speakers across parts`);
			try {
				sameSpeaker = reel.match(await transcribeOne({ file: reel.file }));
			} catch (error) {
				// The parts' labels stay apart, and the warning below says so.
				if (!(error instanceof TranscriptionError)) throw error;
			}
		}
	}

	const content = transcriptFromParts(parts, speakers, sameSpeaker);
	if (!content) throw lastFailure ?? failure("empty", context);

	const warnings: string[] = [];
	const failed = parts.filter((part) => !part.transcript).length;
	if (failed > 0) {
		warnings.push(
			`Transcription saved, but ${failed} of ${parts.length} chunk(s) failed - look for [Error transcribing chunk N] markers and re-run after deleting the note to retry.`,
		);
	}
	if (choice.unknownModel) {
		warnings.push(
			`This version of PodNotes has no ${choice.unknownModel} model, so ${choice.label} used ${model.label}.`,
		);
	}
	if (choice.withdrawnModel) {
		warnings.push(
			`${choice.label} no longer offers ${choice.withdrawnModel.label}, so PodNotes used ${model.label}.`,
		);
	}
	if (choice.speakers && !model.speakers) {
		warnings.push(
			`Saved without speaker labels, because ${choice.label} does not label speakers. These providers do: ${providersWithSpeakers().join(", ")}.`,
		);
	}
	// A request routed where the speaker option is ignored is answered without speakers.
	const labeled = parts.some(
		({ transcript }) =>
			transcript &&
			"words" in transcript &&
			transcript.words.some((word) => word.speaker !== undefined),
	);
	if (speakers && !labeled) {
		warnings.push(`Saved without speaker labels, because ${model.label} returned none.`);
	}
	if (speakers && labeled && parts.length > 1 && !sameSpeaker?.size) {
		warnings.push(
			`${choice.label} transcribed this episode in ${parts.length} parts, and speaker labels restart in each, so one person can have several labels.`,
		);
	}
	return { content, warnings };
}
