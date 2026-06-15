/**
 * Resolve an episode's number, preferring the reliable `<itunes:episode>` tag and
 * falling back to a best-effort parse of the episode title.
 *
 * The title fallback only fires when `<itunes:episode>` is absent or non-numeric.
 * It recognizes the common numbering conventions podcasts put at the START of a
 * title:
 *   - "#12 ..."                                   -> 12
 *   - "Ep 12 ...", "Ep. 12", "Episode 12", "E12"  -> 12
 *   - "12: ...", "12 - ...", "12. ...", "12) ..."  -> 12
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
	return Number(trimmed);
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

	// Leading marker: "#12", "Ep 12", "Ep. 12", "Episode 12", "E12".
	const labeled = trimmed.match(
		/^(?:#\s*|ep(?:isode)?\.?\s*#?\s*|e)(\d{1,6})\b/i,
	);
	if (labeled) return Number(labeled[1]);

	// Leading number immediately followed by a separator: "12:", "12 -", "12.", "12)".
	const leading = trimmed.match(/^(\d{1,6})\s*[-:.)|]/);
	if (leading) return Number(leading[1]);

	return undefined;
}
