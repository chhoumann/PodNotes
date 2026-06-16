import { describe, expect, test } from "vitest";
import { formatSeconds } from "./formatSeconds";

describe("formatSeconds", () => {
	test("formats whole seconds into HH:mm:ss", () => {
		expect(formatSeconds(0, "HH:mm:ss")).toBe("00:00:00");
		expect(formatSeconds(3661, "HH:mm:ss")).toBe("01:01:01");
	});

	test("clamps NaN to 0 instead of rendering 'NaN:NaN:NaN' (issue #94)", () => {
		// Happens mid episode-switch when duration is briefly unknown and the
		// remaining-time expression ($duration - $currentTime) evaluates to NaN.
		expect(formatSeconds(Number.NaN, "HH:mm:ss")).toBe("00:00:00");
	});

	test("clamps negative input to 0 instead of rendering negative components (issue #94)", () => {
		// Happens when currentTime momentarily exceeds a shorter next episode's
		// duration, making the remaining time negative.
		expect(formatSeconds(-42, "HH:mm:ss")).toBe("00:00:00");
	});

	test("clamps non-finite Infinity to 0", () => {
		expect(formatSeconds(Number.POSITIVE_INFINITY, "HH:mm:ss")).toBe(
			"00:00:00",
		);
	});
});
