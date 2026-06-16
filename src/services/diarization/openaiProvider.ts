import type { OpenAI } from "openai";
import { type DiarizedSegment, OPENAI_DIARIZE_MODEL } from "./types";
import { parseOpenAIDiarizedSegments } from "./segments";

/**
 * Diarize with OpenAI's `gpt-4o-transcribe-diarize` model (issue #168).
 *
 * Reuses the same chunked `File[]` the Whisper path builds because the
 * transcription endpoint caps a request at 25 MB. `chunking_strategy: "auto"` is
 * required for audio longer than 30s and lets the model segment within a chunk.
 * Speaker labels are assigned per request, so on a multi-chunk (long) episode
 * the labels can differ across chunk boundaries — the caller documents this; a
 * single-chunk episode (the common case) is fully consistent.
 *
 * Chunks are processed in order and their segments concatenated, so the
 * transcript reads start-to-finish. A chunk that keeps failing contributes an
 * error marker segment rather than aborting the whole transcript.
 */
export async function diarizeWithOpenAI(opts: {
	getClient: () => Promise<OpenAI>;
	chunkFiles: File[];
	maxRetries: number;
	onProgress: (message: string) => void;
}): Promise<DiarizedSegment[]> {
	const { getClient, chunkFiles, maxRetries, onProgress } = opts;
	const client = await getClient();
	const segments: DiarizedSegment[] = [];

	for (let index = 0; index < chunkFiles.length; index++) {
		onProgress(
			`Diarizing with OpenAI... chunk ${index + 1}/${chunkFiles.length}`,
		);
		const file = chunkFiles[index];

		let attempt = 0;
		while (true) {
			try {
				const result = await client.audio.transcriptions.create({
					model: OPENAI_DIARIZE_MODEL,
					file,
					// The SDK types `response_format`/`chunking_strategy` for this model,
					// but the create() overload returns a union; parse from the raw
					// payload so we never depend on which arm TS narrows to.
					response_format: "diarized_json",
					chunking_strategy: "auto",
				});
				segments.push(...parseOpenAIDiarizedSegments(result));
				break;
			} catch (error) {
				attempt++;
				if (attempt >= maxRetries) {
					console.error(
						`OpenAI diarization failed for chunk ${index} after ${maxRetries} attempts:`,
						error,
					);
					segments.push({
						speaker: "?",
						text: `[Error diarizing chunk ${index + 1}]`,
					});
					break;
				}
				await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
			}
		}
	}

	return segments;
}
