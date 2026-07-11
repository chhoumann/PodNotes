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
 * mode (plain Whisper, or OpenAI diarization) reuses the OpenAI credential. Used to gate
 * the transcribe command and guard the service so a user can't kick off a run
 * that is certain to fail for a missing key. Pure so it is unit-testable and
 * usable from both the command callback and the service.
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
