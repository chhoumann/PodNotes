/**
 * Formats a duration in seconds to a time string.
 * Supports common Moment.js-style format tokens for backward compatibility:
 * - H, HH: hours (0-23, 00-23)
 * - h, hh: hours (1-12, 01-12)
 * - m, mm: minutes (0-59, 00-59)
 * - s, ss: seconds (0-59, 00-59)
 * - A: AM/PM, a: am/pm
 *
 * Tokens are substituted in a SINGLE pass so a value inserted for one token can
 * never be re-matched by a later token (the old chained `.replace()` calls
 * corrupted any format containing literal letters that collide with tokens, e.g.
 * "Hh" or words). Literal letters are escaped with a backslash, matching Moment's
 * own escaping (e.g. `\\h` renders a literal "h"). See issue #?? (TS-09).
 */
export function formatSeconds(totalSeconds: number, format: string): string {
	// Clamp non-finite (NaN/Infinity) and negative inputs to 0 so the player never
	// renders garbled times like "NaN:NaN:NaN" or "-1:-1:-10". These arise during
	// an episode switch, when duration is briefly unknown (NaN) before the new
	// audio's metadata loads, or when currentTime momentarily exceeds a shorter
	// next episode's duration (issue #94).
	if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
		totalSeconds = 0;
	}

	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const secs = Math.floor(totalSeconds % 60);

	const hours12 = hours % 12 || 12;
	const isPM = hours >= 12;

	const pad = (n: number): string => n.toString().padStart(2, "0");

	// Longest tokens first so the alternation prefers HH over H, etc.
	const tokens: Record<string, string> = {
		HH: pad(hours),
		hh: pad(hours12),
		mm: pad(minutes),
		ss: pad(secs),
		H: hours.toString(),
		h: hours12.toString(),
		m: minutes.toString(),
		s: secs.toString(),
		A: isPM ? "PM" : "AM",
		a: isPM ? "pm" : "am",
	};

	// `\\(.)` consumes an escaped literal first (emitting the escaped char as-is),
	// otherwise the longest matching token is replaced. Everything else (`:`, `-`,
	// spaces, unescaped non-token letters) passes through untouched.
	return format.replace(/\\(.)|HH|hh|mm|ss|H|h|m|s|A|a/g, (match, escaped) =>
		escaped !== undefined ? escaped : tokens[match],
	);
}
