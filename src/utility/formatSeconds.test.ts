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
		expect(formatSeconds(Number.POSITIVE_INFINITY, "HH:mm:ss")).toBe("00:00:00");
	});

	test("substitutes each token once, never re-matching inserted digits (TS-09)", () => {
		// 12h, 34m, 56s -> with 12-hour token h=12; a single pass must not let the
		// '1'/'2' it inserts get reconsidered by a later token.
		expect(formatSeconds(45296, "h:mm:ss A")).toBe("12:34:56 PM");
		// h -> "1", then \\h -> literal "h": proves the inserted "1" isn't re-scanned.
		expect(formatSeconds(3661, "h\\h")).toBe("1h");
	});

	test("honors backslash escaping for literal letters (TS-09)", () => {
		// Without escaping, the old chained replaces corrupted any literal letter
		// that collided with a token. `\\h` must render a literal 'h'.
		expect(formatSeconds(3661, "mm\\m ss\\s")).toBe("01m 01s");
		expect(formatSeconds(3661, "\\H\\o\\u\\r")).toBe("Hour");
	});
});
