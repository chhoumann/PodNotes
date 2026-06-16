export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 4;
export const PLAYBACK_RATE_STEP = 0.1;
export const DEFAULT_PLAYBACK_RATE = 1;

export function normalizePlaybackRate(
	value: unknown,
	fallback = DEFAULT_PLAYBACK_RATE,
): number {
	const numeric = typeof value === "number" ? value : Number(value);
	const fallbackRate = Number.isFinite(fallback)
		? fallback
		: DEFAULT_PLAYBACK_RATE;

	if (!Number.isFinite(numeric)) {
		return clampPlaybackRate(fallbackRate);
	}

	return clampPlaybackRate(numeric);
}

export function adjustPlaybackRate(
	currentRate: number,
	delta: number,
): number {
	return normalizePlaybackRate(roundToTenths(currentRate + delta));
}

function clampPlaybackRate(value: number): number {
	return Math.min(
		PLAYBACK_RATE_MAX,
		Math.max(PLAYBACK_RATE_MIN, roundToTenths(value)),
	);
}

function roundToTenths(value: number): number {
	return Math.round(value * 10) / 10;
}
