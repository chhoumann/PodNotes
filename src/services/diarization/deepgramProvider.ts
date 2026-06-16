import { requestUrl, type RequestUrlResponse } from "obsidian";
import type { DiarizationAudio, DiarizedSegment } from "./types";
import { parseDeepgramSegments } from "./segments";

/** The injectable shape of Obsidian's `requestUrl` (so tests can stub the network). */
export type RequestUrlFn = (params: {
	url: string;
	method: string;
	headers: Record<string, string>;
	contentType: string;
	body: ArrayBuffer;
	throw: boolean;
}) => Promise<RequestUrlResponse>;

const DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen";

/**
 * Query params for the pre-recorded request. `diarize=true` is the broadly
 * available diarizer; `smart_format`/`punctuate` make the text readable and
 * `utterances=true` returns ready-made speaker turns the parser prefers. Sent as
 * a single whole-file request, so speaker identity stays consistent across the
 * entire episode (no cross-chunk drift).
 */
const DEEPGRAM_QUERY =
	"model=nova-3&diarize=true&punctuate=true&smart_format=true&utterances=true";

/**
 * Diarize with Deepgram's pre-recorded speech-to-text API (issue #168).
 *
 * Posts the whole original (compressed) audio in one synchronous request via
 * Obsidian's `requestUrl` (which bypasses CORS and works on mobile). No chunking
 * is needed — Deepgram accepts large files server-side — which is exactly why
 * its speaker labels stay consistent for the full episode.
 */
export async function diarizeWithDeepgram(opts: {
	audio: DiarizationAudio;
	apiKey: string;
	onProgress: (message: string) => void;
	request?: RequestUrlFn;
}): Promise<DiarizedSegment[]> {
	const { audio, apiKey, onProgress } = opts;
	const request = opts.request ?? (requestUrl as unknown as RequestUrlFn);

	onProgress("Diarizing with Deepgram...");

	const response = await request({
		url: `${DEEPGRAM_LISTEN_URL}?${DEEPGRAM_QUERY}`,
		method: "POST",
		headers: { Authorization: `Token ${apiKey}` },
		contentType: audio.mimeType,
		body: audio.buffer,
		throw: false,
	});

	if (response.status < 200 || response.status >= 300) {
		const detail = extractDeepgramError(response);
		console.error("Deepgram diarization request failed:", response.status, detail);
		throw new Error(
			`Deepgram request failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
		);
	}

	return parseDeepgramSegments(response.json);
}

/** Pull a human-readable message out of Deepgram's error body, if any. */
function extractDeepgramError(response: RequestUrlResponse): string {
	try {
		const body = response.json as unknown;
		if (body && typeof body === "object") {
			const record = body as Record<string, unknown>;
			const message = record.err_msg ?? record.message ?? record.reason;
			if (typeof message === "string") return message;
		}
	} catch {
		// Non-JSON error body; fall back to the raw text below.
	}
	return typeof response.text === "string" ? response.text.slice(0, 200) : "";
}
