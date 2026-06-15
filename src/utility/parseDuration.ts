/**
 * Parse an `<itunes:duration>` value into a whole number of seconds.
 *
 * Per the podcast namespace the value is either a count of seconds ("3600") or a
 * colon-separated clock ("MM:SS" or "HH:MM:SS"). Fractional seconds are floored.
 * Returns `undefined` for empty, malformed, or non-numeric input.
 */
export function parseDurationToSeconds(
	value: string | null | undefined,
): number | undefined {
	if (value === null || value === undefined) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	if (trimmed.includes(":")) {
		const parts = trimmed.split(":").map((part) => part.trim());
		// Accept only MM:SS or HH:MM:SS shapes.
		if (parts.length < 2 || parts.length > 3) return undefined;
		if (parts.some((part) => !/^\d+$/.test(part))) return undefined;
		return parts.reduce((total, part) => total * 60 + Number(part), 0);
	}

	if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
	return Math.floor(Number(trimmed));
}
