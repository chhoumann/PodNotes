import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { CredentialKind } from "src/types/Credentials";

export * from "./types";
export * from "./segments";
export { diarizeWithOpenAI } from "./openaiProvider";
export { diarizeWithDeepgram } from "./deepgramProvider";

/**
 * Whether the credentials the active transcription mode needs are present.
 *
 * Diarization via Deepgram needs the dedicated Deepgram credential; every other
 * mode (plain Whisper, or OpenAI diarization) reuses the OpenAI credential. The
 * transcription service checks it before it queues an audio transcription, so a
 * run that is certain to fail for a missing key never starts, and before it
 * offers transcription from audio when a published transcript fails. The
 * transcribe commands stay available without a key, so running one explains
 * what is missing (TR-02).
 */
export function requiredTranscriptionKeyPresent(
	settings: IPodNotesSettings,
	hasCredential: (kind: CredentialKind) => boolean,
): boolean {
	const diarization = settings.transcript?.diarization;
	if (diarization?.enabled && diarization.provider === "deepgram") {
		return hasCredential("deepgram");
	}
	return hasCredential("openai");
}
