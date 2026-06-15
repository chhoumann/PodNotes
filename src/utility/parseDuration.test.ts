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
