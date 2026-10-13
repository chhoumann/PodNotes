import { describe, expect, test } from "vitest";
import { adjustPlaybackRate, normalizePlaybackRate } from "./playbackRate";

describe("playback rate", () => {
	test("keeps the rate menu's quarter steps", () => {
		expect([0.75, 1.25, 1.75].map((rate) => normalizePlaybackRate(rate))).toEqual([
			0.75, 1.25, 1.75,
		]);
	});

	test("steps by a tenth from a quarter step, without float noise", () => {
		expect(adjustPlaybackRate(1.25, 0.1)).toBe(1.35);
		expect(adjustPlaybackRate(1.1, 0.1)).toBe(1.2);
		expect(adjustPlaybackRate(0.75, -0.1)).toBe(0.65);
	});

	test("clamps to 0.5 to 4, and falls back for a rate that is not a number", () => {
		expect([normalizePlaybackRate(0.1), normalizePlaybackRate(9)]).toEqual([0.5, 4]);
		expect(normalizePlaybackRate("fast", 1.5)).toBe(1.5);
	});
});
