/**
 * Cross-platform safe cap for a single path component (file or folder name),
 * measured in BYTES. The most restrictive mainstream limits are per-component,
 * not per-path: NTFS/Windows and APFS cap names at 255 UTF-16 units, while
 * ext4/F2FS (Linux, and Android internal storage) cap them at 255 *bytes*.
 * Budgeting by UTF-8 byte length satisfies all of them at once, so a long
 * episode title (e.g. The Tim Ferriss Show) — including non-ASCII titles where
 * one character is several bytes — no longer produces a name the filesystem
 * rejects with ENAMETOOLONG. See issue #22.
 *
 * This caps each path *component*; it does not bound the total path length
 * (Windows legacy MAX_PATH), which would require knowing the absolute vault root.
 * The per-component limit is what a long title actually trips.
 */
export const MAX_FILENAME_BYTES = 255;

/**
 * Base name used when a title sanitizes/truncates down to nothing — e.g. a title
 * made entirely of illegal characters becomes "" after sanitization. Without it
 * the path would end in a bare ".md", a hidden dotfile Obsidian never indexes.
 * See issue #99 (the empty-name edge case flagged when illegal-char handling
 * landed).
 */
export const FALLBACK_BASENAME = "Untitled";

const encoder = new TextEncoder();

function byteLength(value: string): number {
	return encoder.encode(value).length;
}

/**
 * Truncate `value` to at most `maxBytes` UTF-8 bytes, cutting only on code-point
 * boundaries so a surrogate pair (e.g. an emoji) is never split into a lone,
 * malformed half. Iterating with `for...of` yields whole code points.
 */
function truncateToByteBudget(value: string, maxBytes: number): string {
	if (byteLength(value) <= maxBytes) {
		return value;
	}

	let result = "";
	let used = 0;
	for (const codePoint of value) {
		const size = byteLength(codePoint);
		if (used + size > maxBytes) {
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

function capFolderName(segment: string): string {
	if (byteLength(segment) <= MAX_FILENAME_BYTES) {
		return segment;
	}

	return (
		trimSegmentEdges(truncateToByteBudget(segment, MAX_FILENAME_BYTES)) ||
		FALLBACK_BASENAME
	);
}

function capFileName(segment: string, extension: string): string {
	// The path is built by addExtension, so the final segment normally ends with
	// the known extension. Split it off (when present), cap only the base name,
	// then always reattach the extension so the file stays a Markdown note even
	// after truncation or when a caller passed a path without the suffix.
	const hasExtension = segment.toLowerCase().endsWith(extension.toLowerCase());
	const base = hasExtension
		? segment.slice(0, segment.length - extension.length)
		: segment;

	const budget = Math.max(1, MAX_FILENAME_BYTES - byteLength(extension));
	const cappedBase =
		trimSegmentEdges(truncateToByteBudget(base, budget)) || FALLBACK_BASENAME;

	return `${cappedBase}${extension}`;
}

/**
 * Make a vault-relative note path safe to create across platforms:
 *  - drop empty path segments (collapsing `a//b` and stray leading/trailing `/`),
 *    which would otherwise create invalid or empty folder names;
 *  - cap every path component at {@link MAX_FILENAME_BYTES} UTF-8 bytes,
 *    truncating the title (the file's base name) while preserving its extension
 *    and the surrounding folders;
 *  - substitute {@link FALLBACK_BASENAME} when the file name reduces to nothing
 *    (e.g. an all-illegal-character title);
 *  - trim trailing dots/spaces a truncation may expose (illegal on Windows).
 *
 * The `extension` (default ".md") is the suffix already appended to `path`; it is
 * kept intact so the file stays a Markdown note even after truncation.
 */
export function enforceMaxPathLength(path: string, extension = ".md"): string {
	const segments = path.split("/").filter((segment) => segment.length > 0);

	if (segments.length === 0) {
		return `${FALLBACK_BASENAME}${extension}`;
	}

	const lastIndex = segments.length - 1;

	return segments
		.map((segment, index) =>
			index === lastIndex
				? capFileName(segment, extension)
				: capFolderName(segment),
		)
		.join("/");
}
