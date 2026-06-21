/**
 * Speaker diarization adds "who spoke when" labels to a transcript (issue #168).
 *
 * OpenAI Whisper (`whisper-1`) — the plugin's default transcription backend —
 * produces no speaker labels, so diarization is an opt-in path that routes the
 * audio to a diarization-capable provider instead. Two providers are supported:
 *
 * - `openai`: the `gpt-4o-transcribe-diarize` model on the same
 *   `/v1/audio/transcriptions` endpoint the plugin already uses, reusing the
 *   user's existing OpenAI key. Convenient, but the ~20 MB chunk limit (a
 *   conservative margin under OpenAI's 25 MB request cap) means a long episode is
 *   split into chunks whose speaker labels are not guaranteed to line up across
 *   chunk boundaries (the labels are assigned per request).
 * - `deepgram`: a single whole-file request to Deepgram's pre-recorded API,
 *   which keeps speaker identity consistent across the entire episode but needs
 *   its own API key.
 */
export type DiarizationProviderId = "openai" | "deepgram";

export const DIARIZATION_PROVIDERS: readonly DiarizationProviderId[] = [
	"openai",
	"deepgram",
];

/** The fixed OpenAI model that performs diarization (no other OpenAI model does). */
export const OPENAI_DIARIZE_MODEL = "gpt-4o-transcribe-diarize";

/**
 * One contiguous turn of speech attributed to a single speaker. `speaker` is the
 * provider's label, normalized to a short human-facing token (OpenAI emits `A`,
 * `B`, ...; Deepgram emits 0-based integers which we present 1-based as `1`,
 * `2`, ...). `start`/`end` are seconds when the provider reports them.
 */
export interface DiarizedSegment {
	speaker: string;
	text: string;
	start?: number;
	end?: number;
}

/** The whole, original (compressed) episode audio handed to a diarization provider. */
export interface DiarizationAudio {
	buffer: ArrayBuffer;
	mimeType: string;
	extension: string;
	basename: string;
}
