/**
 * Resolve an episode's number, preferring the reliable `<itunes:episode>` tag and
 * falling back to a best-effort parse of the episode title.
 *
 * The title fallback fires when `<itunes:episode>` is absent or not a number.
 * It recognizes the common numbering conventions podcasts put at the START of a
 * title:
 *   - "#12 ..."                                          -> 12
 *   - "Ep 12 ...", "Ep. 12", "Episode 12", "Ep #12", "E12"  -> 12
 *   - "12: ...", "12 - ...", "12. ...", "12) ..."         -> 12
 *
 * It deliberately requires a leading marker or a trailing separator so it does
 * not pick up arbitrary numbers in the middle of a title. It remains best-effort:
 * a title that simply begins with an unrelated number (e.g. "2024: A Review") can
 * still be misread, so feeds without `<itunes:episode>` should treat the result
 * as approximate. Returns `undefined` when no number can be determined.
 */
export function parseEpisodeNumber(
	itunesEpisode: string | null | undefined,
	title: string | null | undefined,
): number | undefined {
	const fromItunes = parseNonNegativeInt(itunesEpisode);
	if (fromItunes !== undefined) return fromItunes;

	return parseEpisodeNumberFromTitle(title);
}

function parseNonNegativeInt(
	value: string | null | undefined,
): number | undefined {
	if (value === null || value === undefined) return undefined;
	const trimmed = value.trim();
	if (!/^\d+$/.test(trimmed)) return undefined;
	const parsed = Number(trimmed);
	// Reject values that lose integer precision (a 21-digit feed value would
	// otherwise become "1e+21" and leak that text into file names).
	return Number.isSafeInteger(parsed) ? parsed : undefined;
}

/**
 * Best-effort extraction of an episode number from the start of a title. Exported
 * for focused unit testing of the heuristics; prefer {@link parseEpisodeNumber}.
 */
export function parseEpisodeNumberFromTitle(
	title: string | null | undefined,
): number | undefined {
	const trimmed = (title ?? "").trim();
	if (!trimmed) return undefined;

	// Only the start of a title can carry the episode number, so bound the
	// inspected prefix. This keeps the matching linear on hostile, very long
	// titles (e.g. "Ep" + 200k spaces) that would otherwise be a ReDoS vector.
	const head = trimmed.slice(0, 64);

	// Leading marker: "#12", "Ep 12", "Ep. 12", "Episode 12", "Ep #12", "E12".
	// Note the single \s* (no two adjacent whitespace quantifiers) so there is no
	// ambiguous backtracking. The trailing (?!\.\d) rejects a decimal like
	// "Ep 10.5" so it is not misread as episode 10.
	const labeled = head.match(/^(?:#\s*|ep(?:isode)?\.?\s*#?|e)(\d{1,6})\b(?!\.\d)/i);
	if (labeled) return Number(labeled[1]);

	// Leading number followed by a separator: "12:", "12 -", "12.", "12)".
	// A "." only separates when it is NOT followed by a digit, so a decimal such
	// as "10.5 The Bonus" is not misread as episode 10.
	const leading = head.match(/^(\d{1,6})\s*(?:[-:)|]|\.(?!\d))/);
	if (leading) return Number(leading[1]);

	return undefined;
}
