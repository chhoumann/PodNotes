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

export interface BinaryAppendAdapter {
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	appendBinary?(path: string, data: ArrayBuffer): Promise<void>;
	// Used to move a completed download from its temp path into the final vault
	// path and to sweep orphaned temps. Present on the desktop and mobile
	// Capacitor adapters but — like appendBinary — absent from Obsidian's public
	// DataAdapter typings, so they live behind the same single cast below.
	rename?(from: string, to: string): Promise<void>;
	copy?(from: string, to: string): Promise<void>;
	remove?(path: string): Promise<void>;
	list?(path: string): Promise<{ files: string[]; folders: string[] }>;
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
): Promise<number> {
	const adapter = appendableAdapter();

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
export function partialPathFor(filePath: string): string {
	const slash = filePath.lastIndexOf("/");
	const dir = slash === -1 ? "" : filePath.slice(0, slash + 1);
	const name = slash === -1 ? filePath : filePath.slice(slash + 1);
	const token = `${Date.now().toString(36)}-${(partialCounter++).toString(36)}`;
	return `${dir}.${name}.${token}${PARTIAL_SUFFIX}`;
}

export function isPartialPath(path: string): boolean {
	const name = path.slice(path.lastIndexOf("/") + 1);
	return name.startsWith(".") && name.endsWith(PARTIAL_SUFFIX);
}

// Move the completed temp file to its final vault path as a single operation, so
// watchers see one create of an already-complete file. Prefer rename: it is in-
// place (buffers zero bytes, preserving #113's memory win) and is the path every
// real adapter — desktop FileSystemAdapter, iOS/Android CapacitorAdapter — takes.
// copy+remove is a non-mobile fallback. We deliberately do NOT fall back to
// readBinary→writeBinary: re-buffering the whole 50-200 MB file would reintroduce
// the #113 OOM (and can trip the Android writeBinary large-file hang) on the exact
// devices this fix targets — so an adapter with neither rename nor copy fails loudly.
export async function moveIntoPlace(
	tmpPath: string,
	filePath: string,
): Promise<void> {
	const adapter = appendableAdapter();
	if (typeof adapter.rename === "function") {
		await adapter.rename(tmpPath, filePath);
		return;
	}
	if (
		typeof adapter.copy === "function" &&
		typeof adapter.remove === "function"
	) {
		await adapter.copy(tmpPath, filePath);
		await adapter.remove(tmpPath);
		return;
	}
	throw new Error(
		"Adapter cannot move a completed download into place (no rename/copy).",
	);
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
	if (
		typeof adapter.list !== "function" ||
		typeof adapter.remove !== "function"
	) {
		return;
	}
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
