import { type DataAdapter, requestUrl } from "obsidian";
import { get } from "svelte/store";
import { plugin } from "../store";
import { assertFetchableUrl } from "../utility/assertFetchableUrl";
import { encodeUrlForRequest } from "../utility/encodeUrlForRequest";
import { enforceMaxPathLength } from "../utility/enforceMaxPathLength";

// ---- Streaming download (issue #113) ---------------------------------------
// Mobile WebViews have a tight per-process memory budget. Buffering a whole
// episode (hundreds of MB) via requestUrl().arrayBuffer — plus the native->JS
// bridge copy — used to OOM-kill Obsidian on iOS. Instead we pull the file in
// bounded HTTP Range chunks and append each straight to disk, so peak heap
// stays at roughly one chunk regardless of episode size.
//
// ---- Temp-then-move (Waypoint et al. crash) --------------------------------
// Appending chunks directly to the final vault path makes the growing, half-
// written media file visible to the vault's file watcher: a single download
// fires ~12 create/modify events. Watcher plugins (Waypoint, Dataview, Obsidian
// Git, MOC/index generators) react to each one and re-scan the partial file,
// and that synchronous re-scan storm — racing the chunked writer — OOM-crashes
// the app on mobile. So we stream every chunk to a dot-prefixed sibling temp
// (which Obsidian keeps out of the file index entirely, so it fires zero events
// while it grows), then move the finished, size-verified file into place as a
// single rename. Watchers then see exactly one create of an already-complete
// file — the same shape the pre-#113 atomic createBinary path produced.

export const DOWNLOAD_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MiB per range request

// Total-bytes ceiling for a single download. The per-chunk bound above keeps
// peak memory flat, but without a TOTAL cap a malicious media server (the host of
// a feed's enclosure URL is attacker-controlled) can fill the disk: it can answer
// 200 with an enormous body, advertise an arbitrarily large Content-Range total,
// or - with an unknown total ("bytes 0-N/*") - return full-size 206 chunks forever
// so the append loop never terminates. 2 GiB clears any real podcast episode
// (long-form audio is ~hundreds of MB; even large video episodes fit) while
// turning the unbounded write into a bounded, recoverable failure.
export const MAX_DOWNLOAD_SIZE = 2 * 1024 * 1024 * 1024; // 2 GiB

function tooLargeError(maxSize: number): Error {
	const maxMb = Math.round(maxSize / (1024 * 1024));
	return new Error(
		`Download exceeds the maximum allowed size (${maxMb} MB). Aborting.`,
	);
}

// Obsidian's DataAdapter — writeBinary/rename/remove/list, all used below — is
// fully typed and public. Only `appendBinary` exists at runtime on the desktop and
// mobile Capacitor adapters without appearing in the public typings, so we extend
// the real interface with that single bolt-on and keep one cast (appendableAdapter).
export interface BinaryAppendAdapter extends DataAdapter {
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
	maxSize: number = MAX_DOWNLOAD_SIZE,
): Promise<RangeProbe> {
	assertFetchableUrl(url);
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

	// Reject an oversized download up front: a known total over the cap, or a 200
	// fallback whose whole body (requestUrl has already buffered it) is over the
	// cap. The unknown-total 206 case can't be caught here and is bounded by the
	// running-total check in writeStreamedFile instead.
	if (totalSize !== null && totalSize > maxSize) {
		throw tooLargeError(maxSize);
	}
	if (!supportsRange && response.arrayBuffer.byteLength > maxSize) {
		throw tooLargeError(maxSize);
	}

	return {
		firstChunk: response.arrayBuffer,
		contentType,
		supportsRange,
		totalSize,
	};
}

// Write the already-fetched first chunk, then pull the remaining bytes in
// bounded Range requests, appending each straight to `destPath`. Peak memory is
// one chunk, not the whole file. Returns the total number of bytes written.
// `destPath` is the temp path (see partialPathFor); the caller moves the result
// into the final vault path once it is complete and size-verified.
export async function writeStreamedFile(
	url: string,
	destPath: string,
	probe: RangeProbe,
	onProgress?: (written: number, total: number | null) => void,
	chunkSize: number = DOWNLOAD_CHUNK_SIZE,
	maxSize: number = MAX_DOWNLOAD_SIZE,
): Promise<number> {
	assertFetchableUrl(url);
	const adapter = appendableAdapter();

	if (probe.firstChunk.byteLength > maxSize) {
		throw tooLargeError(maxSize);
	}

	await adapter.writeBinary(destPath, probe.firstChunk);
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

		await adapter.appendBinary(destPath, chunk);
		written += chunk.byteLength;
		onProgress?.(written, probe.totalSize);

		// Hard ceiling on the total written. This is the only stop for a server
		// that advertises an unknown total ("bytes 0-N/*") and returns full-size
		// 206 chunks forever — without it the loop would append to disk until the
		// disk fills. The caller's finally drops the (now over-cap) temp file.
		if (written > maxSize) {
			throw tooLargeError(maxSize);
		}

		// Unknown total: a short chunk means we hit EOF.
		if (probe.totalSize === null && chunk.byteLength < chunkSize) break;
	}

	return written;
}

const PARTIAL_SUFFIX = ".podnotes-partial";

// A monotonic counter makes every temp name unique within a session even when two
// downloads resolve to the same final path (distinct episodes can collide on one
// path — #107/#183) and start in the same millisecond, so concurrent downloads
// never share a temp file.
let partialCounter = 0;

// The sibling temp path a download streams to before being moved into place. It is
// dot-prefixed so Obsidian keeps it out of the file index (no watcher events while
// it grows), lives in the same folder as the final file so the move is a cheap
// in-place rename, and carries a unique token so concurrent downloads can't clash.
// The token comes first so it survives the length cap (#22), which trims the tail:
// the final name's own segment is already at the byte limit, and prepending a dot +
// appending the suffix would otherwise push the temp past ENAMETOOLONG. The embedded
// final name is only there to make the temp recognisable while debugging.
export function partialPathFor(filePath: string): string {
	const slash = filePath.lastIndexOf("/");
	const dir = slash === -1 ? "" : filePath.slice(0, slash + 1);
	const name = slash === -1 ? filePath : filePath.slice(slash + 1);
	const token = `${Date.now().toString(36)}-${(partialCounter++).toString(36)}`;
	return enforceMaxPathLength(`${dir}.${token}.${name}${PARTIAL_SUFFIX}`, PARTIAL_SUFFIX);
}

export function isPartialPath(path: string): boolean {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.startsWith(".") && name.endsWith(PARTIAL_SUFFIX);
}

// Move the completed temp file to its final vault path with a single rename, so
// watchers see one create of an already-complete file. rename is a standard
// DataAdapter op on every platform and, because the temp is a sibling of the final
// file, an in-place metadata move that buffers zero bytes — preserving #113's
// memory win. (We never finalize by reading the temp back into memory and
// re-writing it: that whole-file buffer is exactly the #113 OOM this path avoids.)
export async function moveIntoPlace(
	tmpPath: string,
	filePath: string,
): Promise<void> {
	await appendableAdapter().rename(tmpPath, filePath);
}

// Remove temp partials orphaned in `folder` by a previous download that was hard-
// killed (OOM, force-quit) before it could move its file into place or clean up —
// otherwise hidden partials accumulate and can replicate via sync. `isActive`
// guards this and any concurrent download's live temp from being swept (temp names
// are unique per attempt, so a live temp would otherwise look like an orphan).
// Best-effort: a listing failure must never block a download.
export async function sweepStalePartials(
	folder: string,
	isActive: (path: string) => boolean,
): Promise<void> {
	const adapter = appendableAdapter();
	try {
		const listing = await adapter.list(folder);
		for (const entry of listing.files) {
			if (isPartialPath(entry) && !isActive(entry)) {
				await adapter.remove(entry);
			}
		}
	} catch (error) {
		console.error(
			`Failed to sweep stale download temp files in "${folder}":`,
			error,
		);
	}
}
