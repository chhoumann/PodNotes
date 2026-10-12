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
 * mode (plain Whisper, or OpenAI diarization) reuses the OpenAI credential.
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
