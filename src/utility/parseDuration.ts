// A leap year of seconds. Real podcast episodes are far shorter; anything larger
// is malformed/hostile feed data and is rejected so it can never become Infinity.
const MAX_PLAUSIBLE_SECONDS = 86400 * 366;

/**
 * Parse an `<itunes:duration>` value into a whole number of seconds.
 *
 * Per the podcast namespace the value is either a count of seconds ("3600") or a
 * colon-separated clock ("MM:SS" or "HH:MM:SS"). Fractional seconds are floored.
 * Colon segments are summed as-is (a non-normalized "1:90" becomes 150). Returns
 * `undefined` for empty, malformed, non-numeric, or implausibly large input.
 */
export function parseDurationToSeconds(
	value: string | null | undefined,
): number | undefined {
	if (value === null || value === undefined) return undefined;
	const trimmed = value.trim();
	if (!trimmed) return undefined;

	let seconds: number;
	if (trimmed.includes(":")) {
		const parts = trimmed.split(":").map((part) => part.trim());
		// split(":") on a ":"-containing string always yields >= 2 parts; accept
		// only MM:SS or HH:MM:SS.
		if (parts.length > 3) return undefined;
		if (parts.some((part) => !/^\d+$/.test(part))) return undefined;
		seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
	} else {
		if (!/^\d+(\.\d+)?$/.test(trimmed)) return undefined;
		seconds = Math.floor(Number(trimmed));
	}

	// Guard against non-finite/implausible values so a huge digit string can't
	// store Infinity (which would render as "Infinity:NaN:NaN" in a note).
	if (!Number.isFinite(seconds) || seconds > MAX_PLAUSIBLE_SECONDS) {
		return undefined;
	}
	return seconds;
}
