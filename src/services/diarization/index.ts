import type { IPodNotesSettings } from "src/types/IPodNotesSettings";

export * from "./types";
export * from "./segments";
export { diarizeWithOpenAI } from "./openaiProvider";
export { diarizeWithDeepgram, type RequestUrlFn } from "./deepgramProvider";

/**
 * Whether the credentials the active transcription mode needs are present.
 *
 * Diarization via Deepgram needs the dedicated `diarizationApiKey`; every other
 * mode (plain Whisper, or OpenAI diarization) reuses `openAIApiKey`. Used to gate
 * the transcribe command and guard the service so a user can't kick off a run
 * that is certain to fail for a missing key. Pure so it is unit-testable and
 * usable from both the command callback and the service.
 */
export function requiredTranscriptionKeyPresent(
	settings: IPodNotesSettings,
): boolean {
	const diarization = settings.transcript?.diarization;
	if (diarization?.enabled && diarization.provider === "deepgram") {
		return Boolean(settings.diarizationApiKey?.trim());
	}
	return Boolean(settings.openAIApiKey?.trim());
}
