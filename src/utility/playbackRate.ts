export const PLAYBACK_RATE_MIN = 0.5;
export const PLAYBACK_RATE_MAX = 4;
export const PLAYBACK_RATE_STEP = 0.1;
export const DEFAULT_PLAYBACK_RATE = 1;
export const PLAYBACK_RATES: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

export function normalizePlaybackRate(value: unknown, fallback = DEFAULT_PLAYBACK_RATE): number {
	const numeric = typeof value === "number" ? value : Number(value);
	const fallbackRate = Number.isFinite(fallback) ? fallback : DEFAULT_PLAYBACK_RATE;

	if (!Number.isFinite(numeric)) {
		return clampPlaybackRate(fallbackRate);
	}

	return clampPlaybackRate(numeric);
}

export function adjustPlaybackRate(currentRate: number, delta: number): number {
	return normalizePlaybackRate(roundToHundredths(currentRate + delta));
}

function clampPlaybackRate(value: number): number {
	return Math.min(PLAYBACK_RATE_MAX, Math.max(PLAYBACK_RATE_MIN, roundToHundredths(value)));
}

// Hundredths, so the rate menu's quarter steps such as 1.25 survive.
function roundToHundredths(value: number): number {
	return Math.round(value * 100) / 100;
}
