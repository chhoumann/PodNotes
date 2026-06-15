import { formatSeconds } from "./formatSeconds";

/**
 * Format an episode duration (in whole seconds) for display in templates.
 *
 * With no format the output is a human clock that omits the hours segment for
 * short episodes: "4:05" (under an hour) or "1:02:03" (an hour or more).
 *
 * Format keywords (case-insensitive):
 *   - "seconds" -> total seconds ("3723")
 *   - "minutes" -> total whole minutes, floored ("62")
 *
 * Any other format string is passed through to {@link formatSeconds}, so
 * Moment.js-style tokens work too (e.g. "HH:mm:ss" -> "01:02:03").
 */
export function formatDuration(totalSeconds: number, format?: string): string {
	if (!format || !format.trim()) {
		return totalSeconds >= 3600
			? formatSeconds(totalSeconds, "H:mm:ss")
			: formatSeconds(totalSeconds, "m:ss");
	}

	const key = format.trim().toLowerCase();
	if (key === "seconds") return String(Math.floor(totalSeconds));
	if (key === "minutes") return String(Math.floor(totalSeconds / 60));

	return formatSeconds(totalSeconds, format);
}
