import { Platform } from "obsidian";

/**
 * The per-component filename limit is 255 on every mainstream filesystem — but
 * the *unit* differs: NTFS (Windows) and APFS/HFS+ (macOS, iOS) count 255 UTF-16
 * code units, while ext4/F2FS (Linux, and Android internal storage) count 255
 * bytes. A long episode title (e.g. The Tim Ferriss Show) otherwise produces a
 * name the filesystem rejects with ENAMETOOLONG and note creation fails. See #22.
 */
export const MAX_FILENAME_UNITS = 255;

/**
 * Base name used when a title sanitizes/truncates down to nothing — e.g. a title
 * made entirely of illegal characters becomes "" after sanitization. Without it
 * the path would end in a bare ".md", a hidden dotfile Obsidian never indexes.
 * See issue #99 (the empty-name edge case flagged when illegal-char handling
 * landed).
 */
export const FALLBACK_BASENAME = "Untitled";

/** How a path component's length is measured on the current platform. */
export interface FilenameLimit {
	mode: "bytes" | "utf16";
	max: number;
}

const encoder = new TextEncoder();

function byteLength(value: string): number {
	return encoder.encode(value).length;
}

function measure(value: string, mode: FilenameLimit["mode"]): number {
	// "utf16" uses String#length (UTF-16 code units); "bytes" uses UTF-8 bytes.
	return mode === "bytes" ? byteLength(value) : value.length;
}

/**
 * The per-component limit for the OS the user is on, using Obsidian's native
 * `Platform` detection. NTFS/APFS (Windows, macOS, iOS) count UTF-16 code units;
 * ext4/F2FS (Linux, Android) count bytes — verified empirically on APFS, where a
 * 255-unit name (~750 bytes of CJK) is accepted but 256 is rejected. Capping to
 * the local unit keeps the most generous legal name on each OS; the byte mode is
 * the portable floor, so a vault synced from a UTF-16-limit OS to a byte-limit OS
 * could, for heavily multibyte titles, exceed the destination's limit.
 */
export function getPlatformFilenameLimit(): FilenameLimit {
	if (Platform.isWin || Platform.isMacOS || Platform.isIosApp) {
		return { mode: "utf16", max: MAX_FILENAME_UNITS };
	}
	return { mode: "bytes", max: MAX_FILENAME_UNITS };
}

/**
 * Truncate `value` to at most `max` units (bytes or UTF-16 code units), cutting
 * only on code-point boundaries so a surrogate pair (e.g. an emoji) is never
 * split into a lone, malformed half. Iterating with `for...of` yields whole code
 * points; an astral character is kept only when both of its UTF-16 units fit.
 */
function truncateToLimit(
	value: string,
	max: number,
	mode: FilenameLimit["mode"],
): string {
	if (measure(value, mode) <= max) {
		return value;
	}

	let result = "";
	let used = 0;
	for (const codePoint of value) {
		const size = measure(codePoint, mode);
		if (used + size > max) {
			break;
		}
		result += codePoint;
		used += size;
	}

	return result;
}

// Trailing dots and spaces are rejected on Windows; truncating a title can newly
// expose them (e.g. cutting "Episode 1. The Beginning" mid-word). Also trim
// leading whitespace a cut may expose. Mirrors the trimming in
// replaceIllegalFileNameCharactersInString so capped names stay legal.
function trimSegmentEdges(segment: string): string {
	return segment.replace(/[\s.]+$/g, "").replace(/^\s+/, "");
}

function capFolderName(segment: string, limit: FilenameLimit): string {
	const capped =
		measure(segment, limit.mode) <= limit.max
			? segment
			: truncateToLimit(segment, limit.max, limit.mode);

	// Trim even when under the cap: a literal template folder like "Notes. " has
	// a trailing space/dot that is illegal on Windows regardless of length.
	return trimSegmentEdges(capped) || FALLBACK_BASENAME;
}

function capFileName(
	segment: string,
	extension: string,
	limit: FilenameLimit,
): string {
	// The path is built by addExtension, so the final segment normally ends with
	// the known extension. Split it off (when present), cap only the base name,
	// then always reattach the extension so the file stays a Markdown note even
	// after truncation or when a caller passed a path without the suffix.
	const hasExtension = segment.toLowerCase().endsWith(extension.toLowerCase());
	const base = hasExtension
		? segment.slice(0, segment.length - extension.length)
		: segment;

	const budget = Math.max(1, limit.max - measure(extension, limit.mode));
	const cappedBase =
		trimSegmentEdges(truncateToLimit(base, budget, limit.mode)) ||
		FALLBACK_BASENAME;

	return `${cappedBase}${extension}`;
}

/**
 * The extension of a path's final segment (".md", ".txt", …), or "" when it has
 * none. Callers whose extension comes from a user template rather than
 * addExtension (e.g. transcripts) pass this to {@link enforceMaxPathLength} so it
 * preserves the configured extension instead of forcing a default one.
 */
export function lastSegmentExtension(path: string): string {
	const last = path.split("/").pop() ?? "";
	const dot = last.lastIndexOf(".");
	// `dot > 0` so a dotfile (".env") is treated as a name, not an extension.
	return dot > 0 ? last.slice(dot) : "";
}

/**
 * Make a vault-relative note path safe to create across platforms:
 *  - drop empty path segments (collapsing `a//b` and stray leading/trailing `/`),
 *    which would otherwise create invalid or empty folder names;
 *  - cap every path component at the platform's per-component limit
 *    ({@link getPlatformFilenameLimit}), truncating the title (the file's base
 *    name) while preserving its extension and the surrounding folders;
 *  - substitute {@link FALLBACK_BASENAME} when the file name reduces to nothing
 *    (e.g. an all-illegal-character title);
 *  - trim trailing dots/spaces a truncation may expose (illegal on Windows).
 *
 * The `extension` (default ".md") is the suffix already appended to `path`; it is
 * kept intact so the file stays a Markdown note even after truncation. `limit`
 * defaults to the current platform's limit and is injectable for testing.
 */
export function enforceMaxPathLength(
	path: string,
	extension = ".md",
	limit: FilenameLimit = getPlatformFilenameLimit(),
): string {
	const segments = path.split("/").filter((segment) => segment.length > 0);

	if (segments.length === 0) {
		return `${FALLBACK_BASENAME}${extension}`;
	}

	const lastIndex = segments.length - 1;

	return segments
		.map((segment, index) =>
			index === lastIndex
				? capFileName(segment, extension, limit)
				: capFolderName(segment, limit),
		)
		.join("/");
}
