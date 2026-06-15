/**
 * Render an episode number for templates. Returns an empty string when the number
 * is unknown. An all-zeros format (e.g. {{episodeNumber:000}}) zero-pads the value
 * to that width so episode-numbered file names sort correctly; any other format
 * argument is ignored and the bare number is returned.
 */
export function formatEpisodeNumber(
	episodeNumber: number | undefined,
	pad?: string,
): string {
	if (episodeNumber === undefined) return "";
	const value = String(episodeNumber);
	const width = pad?.trim();
	if (width && /^0+$/.test(width)) {
		return value.padStart(width.length, "0");
	}
	return value;
}
