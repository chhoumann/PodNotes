import type { DiarizationAudio, DiarizedSegment } from "./types";
import { parseDeepgramSegments } from "./segments";
import { fetchJsonWithTimeout } from "../../utility/networkRequest";

const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";
const DEEPGRAM_REQUEST_TIMEOUT_MS = 30 * 60_000;
const MAX_DEEPGRAM_AUDIO_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_DEEPGRAM_RESPONSE_BYTES = 16 * 1024 * 1024;

/**
 * Query params for the pre-recorded request. `diarize=true` is the broadly
 * available diarizer; `smart_format`/`punctuate` make the text readable and
 * `utterances=true` returns ready-made speaker turns the parser prefers. Sent as
 * a single whole-file request, so speaker identity stays consistent across the
 * entire episode (no cross-chunk drift).
 */
const DEEPGRAM_QUERY = "model=nova-3&diarize=true&punctuate=true&smart_format=true&utterances=true";

/**
 * Diarize with Deepgram's pre-recorded speech-to-text API (issue #168).
 *
 * Posts the whole original (compressed) audio in one synchronous request via
 * the shared bounded network boundary. No chunking is needed because Deepgram
 * accepts large files server-side, which keeps speaker labels consistent for
 * the full episode.
 */
export async function diarizeWithDeepgram(opts: {
	audio: DiarizationAudio;
	apiKey: string;
	onProgress: (message: string) => void;
	signal?: AbortSignal;
}): Promise<DiarizedSegment[]> {
	const { audio, apiKey, onProgress, signal } = opts;
	onProgress("Diarizing with Deepgram...");

	const response = await fetchJsonWithTimeout<unknown>(
		`${DEEPGRAM_LISTEN_URL}?${DEEPGRAM_QUERY}`,
		{
			method: "POST",
			headers: { Authorization: `Token ${apiKey}` },
			contentType: audio.mimeType,
			body: audio.buffer,
			timeoutMs: DEEPGRAM_REQUEST_TIMEOUT_MS,
			maxRequestBodyBytes: MAX_DEEPGRAM_AUDIO_BYTES,
			maxResponseBytes: MAX_DEEPGRAM_RESPONSE_BYTES,
			signal,
		},
	);

	return parseDeepgramSegments(response);
}
