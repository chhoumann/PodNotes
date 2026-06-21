import type { OpenAI } from "openai";
import { type DiarizedSegment, OPENAI_DIARIZE_MODEL } from "./types";
import { parseOpenAIDiarizedSegments } from "./segments";

/**
 * Diarize with OpenAI's `gpt-4o-transcribe-diarize` model (issue #168).
 *
 * Reuses the same chunked `File[]` the Whisper path builds because the chunker
 * caps each request at ~20 MB (a conservative margin under OpenAI's 25 MB request
 * cap). `chunking_strategy: "auto"` is required for audio longer than 30s and lets
 * the model segment within a chunk.
 * Speaker labels are assigned per request, so on a multi-chunk (long) episode
 * the labels can differ across chunk boundaries — the caller documents this; a
 * single-chunk episode (the common case) is fully consistent.
 *
 * Chunks are processed in order and their segments concatenated, so the
 * transcript reads start-to-finish. A single failed chunk contributes an error
 * marker segment rather than discarding an otherwise-good transcript — but if
 * EVERY chunk fails (e.g. an invalid key or unsupported model) the function
 * throws so the caller writes no file and the run stays retryable, instead of
 * saving a transcript made only of error markers.
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
	let failedChunks = 0;
	let lastError: unknown;

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
				// Each chunk's start/end are relative to that chunk, so the
				// concatenated segments' timestamps are not episode-absolute. The
				// rendered transcript does not surface timestamps today; if it ever
				// does, offset each chunk by the cumulative prior-chunk duration here.
				segments.push(...parseOpenAIDiarizedSegments(result));
				break;
			} catch (error) {
				attempt++;
				if (attempt >= maxRetries) {
					console.error(
						`OpenAI diarization failed for chunk ${index + 1} after ${maxRetries} attempts:`,
						error,
					);
					failedChunks++;
					lastError = error;
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

	if (chunkFiles.length > 0 && failedChunks === chunkFiles.length) {
		const detail = lastError instanceof Error ? lastError.message : String(lastError);
		throw new Error(`OpenAI diarization failed for every chunk: ${detail}`);
	}

	return segments;
}
