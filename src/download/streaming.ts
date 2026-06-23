import { requestUrl } from "obsidian";
import { get } from "svelte/store";
import { plugin } from "../store";
import { encodeUrlForRequest } from "../utility/encodeUrlForRequest";

// ---- Streaming download (issue #113) ---------------------------------------
// Mobile WebViews have a tight per-process memory budget. Buffering a whole
// episode (hundreds of MB) via requestUrl().arrayBuffer — plus the native->JS
// bridge copy — used to OOM-kill Obsidian on iOS. Instead we pull the file in
// bounded HTTP Range chunks and append each straight to disk, so peak heap
// stays at roughly one chunk regardless of episode size.

export const DOWNLOAD_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB per range request

export interface BinaryAppendAdapter {
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	appendBinary?(path: string, data: ArrayBuffer): Promise<void>;
}

export interface RangeProbe {
	firstChunk: ArrayBuffer;
	contentType: string;
	supportsRange: boolean;
	totalSize: number | null;
}

// `appendBinary` exists at runtime on the mobile CapacitorAdapter (and the
// desktop adapter) but isn't in Obsidian's public DataAdapter typings. Keep the
// single unsafe cast here so the "where we step outside the types" boundary is
// greppable in one place.
export function appendableAdapter(): BinaryAppendAdapter {
	return get(plugin).app.vault.adapter as unknown as BinaryAppendAdapter;
}

function readHeader(
	headers: Record<string, string> | undefined,
	name: string,
): string | undefined {
	if (!headers) return undefined;
	const direct = headers[name] ?? headers[name.toLowerCase()];
	if (direct !== undefined) return direct;
	const lower = name.toLowerCase();
	for (const key of Object.keys(headers)) {
		if (key.toLowerCase() === lower) return headers[key];
	}
	return undefined;
}

// Fetch the first chunk with a Range header and learn whether the server
// supports ranged requests (206 + Content-Range) and the total size. A server
// that ignores Range answers 200 with the whole body — the legacy single-buffer
// behaviour — which we detect and treat as already-complete.
export async function probeAndFetchFirstChunk(
	url: string,
	chunkSize: number = DOWNLOAD_CHUNK_SIZE,
): Promise<RangeProbe> {
	const encodedUrl = encodeUrlForRequest(url);
	const response = await requestUrl({
		url: encodedUrl,
		method: "GET",
		headers: { Range: `bytes=0-${chunkSize - 1}` },
		throw: false,
	});

	if (response.status !== 200 && response.status !== 206) {
		throw new Error(`Could not download episode (HTTP ${response.status}).`);
	}

	const contentType = readHeader(response.headers, "content-type") ?? "";
	const supportsRange = response.status === 206;

	let totalSize: number | null = null;
	if (supportsRange) {
		// The total is the value after the slash in Content-Range
		// ("bytes 0-N/TOTAL"). An unknown total ("bytes 0-N/*") leaves totalSize
		// null on purpose — writeStreamedFile then terminates on the short-chunk
		// EOF heuristic. Content-Length on a 206 is only the partial chunk size, so
		// it must NOT be used as the total (it would truncate the download — #218).
		const contentRange = readHeader(response.headers, "content-range");
		const match = contentRange?.match(/\/(\d+)\s*$/);
		if (match) totalSize = Number.parseInt(match[1], 10);
	} else {
		// 200: Range ignored, so the whole file is in this single response.
		const contentLength = readHeader(response.headers, "content-length");
		if (contentLength) {
			const parsed = Number.parseInt(contentLength, 10);
			if (Number.isFinite(parsed)) totalSize = parsed;
		}
	}

	return {
		firstChunk: response.arrayBuffer,
		contentType,
		supportsRange,
		totalSize,
	};
}

// Write the already-fetched first chunk, then pull the remaining bytes in
// bounded Range requests, appending each straight to disk. Peak memory is one
// chunk, not the whole file. Returns the total number of bytes written.
export async function writeStreamedFile(
	url: string,
	filePath: string,
	probe: RangeProbe,
	onProgress?: (written: number, total: number | null) => void,
	chunkSize: number = DOWNLOAD_CHUNK_SIZE,
): Promise<number> {
	const adapter = appendableAdapter();

	await adapter.writeBinary(filePath, probe.firstChunk);
	let written = probe.firstChunk.byteLength;
	onProgress?.(written, probe.totalSize);

	// Server returned the whole body (ignored Range), or this adapter can't
	// append: the first response already holds everything we can get.
	if (!probe.supportsRange || typeof adapter.appendBinary !== "function") {
		return written;
	}

	const encodedUrl = encodeUrlForRequest(url);
	for (;;) {
		if (probe.totalSize !== null && written >= probe.totalSize) break;

		const rangeEnd =
			probe.totalSize !== null
				? Math.min(written + chunkSize, probe.totalSize) - 1
				: written + chunkSize - 1;

		const response = await requestUrl({
			url: encodedUrl,
			method: "GET",
			headers: { Range: `bytes=${written}-${rangeEnd}` },
			throw: false,
		});

		if (response.status === 416) break; // requested past end of file
		if (response.status !== 206) {
			throw new Error(
				`Range request failed (HTTP ${response.status}) at byte ${written}.`,
			);
		}

		const chunk = response.arrayBuffer;
		if (chunk.byteLength === 0) break;

		await adapter.appendBinary(filePath, chunk);
		written += chunk.byteLength;
		onProgress?.(written, probe.totalSize);

		// Unknown total: a short chunk means we hit EOF.
		if (probe.totalSize === null && chunk.byteLength < chunkSize) break;
	}

	return written;
}
