import type { Chapter } from "src/types/Chapter";
import { NetworkError, requestWithTimeout } from "./networkRequest";
import { normalizeChapters } from "./normalizeChapters";

const HEADER_BYTES = 10;
const FIRST_REQUEST_BYTES = 64 * 1024;
/** Chapter and cover art can make a tag several megabytes. A larger tag is not read. */
const MAX_TAG_BYTES = 16 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE: ReadonlySet<string> = new Set(["timeout", "transport-failure", "aborted"]);
const TEXT_ENCODINGS = ["iso-8859-1", "utf-16le", "utf-16be", "utf-8"];

/**
 * The ID3 chapters at the start of the media at `url`, read with Range requests for the
 * tag alone. Undefined when the network failed, so a later call tries again.
 */
export async function fetchId3Chapters(url: string): Promise<Chapter[] | undefined> {
	try {
		const first = await fetchBytes(url, 0, FIRST_REQUEST_BYTES);
		const size = id3TagSize(first);
		if (!size || size > MAX_TAG_BYTES) return [];
		if (first.length >= size || first.length < FIRST_REQUEST_BYTES) {
			return parseId3Chapters(first);
		}
		const tag = new Uint8Array(size);
		tag.set(first);
		tag.set(await fetchBytes(url, first.length, size), first.length);
		return parseId3Chapters(tag);
	} catch (error) {
		// A server that ignores Range answers with the whole file, and asking again would too.
		return error instanceof NetworkError && RETRYABLE.has(error.code) ? undefined : [];
	}
}

async function fetchBytes(url: string, start: number, end: number): Promise<Uint8Array> {
	const response = await requestWithTimeout(url, {
		headers: { Range: `bytes=${start}-${end - 1}` },
		timeoutMs: REQUEST_TIMEOUT_MS,
		maxResponseBytes: end - start,
		acceptedStatuses: [206],
	});
	return new Uint8Array(response.arrayBuffer);
}

/** The bytes of an ID3v2.3 or v2.4 tag from its header on, or undefined when `bytes` starts with none. */
export function id3TagSize(bytes: Uint8Array): number | undefined {
	if (bytes.length < HEADER_BYTES) return undefined;
	const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
	if (magic !== "ID3" || (bytes[3] !== 3 && bytes[3] !== 4)) return undefined;
	const size = synchsafe(bytes, 6);
	return size === undefined ? undefined : HEADER_BYTES + size;
}

/** The CHAP frames of an ID3v2.3 or v2.4 tag, `tag` holding it from its header on. */
export function parseId3Chapters(tag: Uint8Array): Chapter[] {
	const size = id3TagSize(tag);
	if (!size || tag.length < size) return [];
	const version = tag[3];
	const flags = tag[5];
	// Podcast tags are not unsynchronised, and undoing it would rewrite every frame.
	if (flags & 0x80) return [];
	let start = HEADER_BYTES;
	if (flags & 0x40) {
		const extended = version === 4 ? synchsafe(tag, start) : uint32(tag, start) + 4;
		if (extended === undefined) return [];
		start += extended;
	}

	const chapters: Chapter[] = [];
	for (const chap of framesOf(tag.subarray(start, size), version)) {
		if (chap.id !== "CHAP") continue;
		const idEnd = chap.body.indexOf(0);
		if (idEnd < 0 || chap.body.length < idEnd + 17) continue;
		const sub = framesOf(chap.body.subarray(idEnd + 17), version);
		const title = sub.find(({ id }) => id === "TIT2");
		chapters.push({
			startTime: uint32(chap.body, idEnd + 1) / 1000,
			title: title ? decodeText(title.body) : "",
		});
	}
	return normalizeChapters(chapters);
}

function framesOf(bytes: Uint8Array, version: number): { id: string; body: Uint8Array }[] {
	const frames = [];
	let at = 0;
	while (at + HEADER_BYTES <= bytes.length && bytes[at] !== 0) {
		const id = String.fromCharCode(...bytes.subarray(at, at + 4));
		const size = version === 4 ? synchsafe(bytes, at + 4) : uint32(bytes, at + 4);
		const end = at + HEADER_BYTES + (size ?? Infinity);
		if (end > bytes.length) break;
		// Compressed, encrypted or otherwise transformed frames are left unread.
		if (bytes[at + 9] === 0) frames.push({ id, body: bytes.subarray(at + HEADER_BYTES, end) });
		at = end;
	}
	return frames;
}

function decodeText(body: Uint8Array): string {
	const text = body.subarray(1);
	const bigEndian = body[0] === 1 && text[0] === 0xfe && text[1] === 0xff;
	const label = bigEndian ? "utf-16be" : TEXT_ENCODINGS[body[0]];
	if (!label) return "";
	return new TextDecoder(label).decode(text).split("\0")[0];
}

function uint32(bytes: Uint8Array, at: number): number {
	return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function synchsafe(bytes: Uint8Array, at: number): number | undefined {
	const parts = bytes.subarray(at, at + 4);
	if (parts.length < 4 || parts.some((part) => part > 0x7f)) return undefined;
	return (parts[0] << 21) | (parts[1] << 14) | (parts[2] << 7) | parts[3];
}
