import { DEFAULT_EPISODE_LIST_LIMIT, MAX_EPISODE_LIST_LIMIT } from "src/constants";

/** Coerce a persisted per-feed episode limit into its supported integer range. */
export function sanitizeEpisodeListLimit(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric) || numeric < 1) {
		return DEFAULT_EPISODE_LIST_LIMIT;
	}

	return Math.min(Math.floor(numeric), MAX_EPISODE_LIST_LIMIT);
}
