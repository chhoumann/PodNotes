import { describe, expect, it } from "vitest";
import { parseDurationToSeconds } from "./parseDuration";

describe("parseDurationToSeconds", () => {
	it("parses a plain seconds count", () => {
		expect(parseDurationToSeconds("3600")).toBe(3600);
		expect(parseDurationToSeconds(" 90 ")).toBe(90);
		expect(parseDurationToSeconds("0")).toBe(0);
	});

	it("floors fractional seconds", () => {
		expect(parseDurationToSeconds("90.9")).toBe(90);
	});

	it("parses MM:SS", () => {
		expect(parseDurationToSeconds("45:30")).toBe(45 * 60 + 30);
		expect(parseDurationToSeconds("00:05")).toBe(5);
	});

	it("parses HH:MM:SS", () => {
		expect(parseDurationToSeconds("1:02:03")).toBe(3723);
		expect(parseDurationToSeconds("01:02:03")).toBe(3723);
	});

	it("sums non-normalized colon segments as-is (documented behavior)", () => {
		expect(parseDurationToSeconds("1:90")).toBe(150);
	});

	it("rejects non-finite / implausibly large values", () => {
		// A huge digit string would become Infinity via Number(); must be rejected
		// so it never renders as "Infinity:NaN:NaN".
		expect(parseDurationToSeconds("9".repeat(400))).toBeUndefined();
		// Larger than a leap year of seconds.
		expect(parseDurationToSeconds("999999999")).toBeUndefined();
	});

	it("accepts the plausible-range boundary and rejects one past it", () => {
		// MAX_PLAUSIBLE_SECONDS = 86400 * 366 = 31622400 (strict > rejects).
		expect(parseDurationToSeconds("31622400")).toBe(31622400);
		expect(parseDurationToSeconds("31622401")).toBeUndefined();
	});

	it("returns undefined for empty or malformed input", () => {
		expect(parseDurationToSeconds(undefined)).toBeUndefined();
		expect(parseDurationToSeconds(null)).toBeUndefined();
		expect(parseDurationToSeconds("")).toBeUndefined();
		expect(parseDurationToSeconds("   ")).toBeUndefined();
		expect(parseDurationToSeconds("abc")).toBeUndefined();
		expect(parseDurationToSeconds("1:aa:03")).toBeUndefined();
		expect(parseDurationToSeconds("1:2:3:4")).toBeUndefined();
	});
});
