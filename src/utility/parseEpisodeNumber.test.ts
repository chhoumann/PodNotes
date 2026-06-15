import { describe, expect, it } from "vitest";
import {
	parseEpisodeNumber,
	parseEpisodeNumberFromTitle,
} from "./parseEpisodeNumber";

describe("parseEpisodeNumber", () => {
	it("prefers a numeric <itunes:episode> value", () => {
		expect(parseEpisodeNumber("42", "#7 Lucky Seven")).toBe(42);
		expect(parseEpisodeNumber(" 12 ", "anything")).toBe(12);
		expect(parseEpisodeNumber("0", "Episode 99")).toBe(0);
	});

	it("falls back to the title when <itunes:episode> is absent or non-numeric", () => {
		expect(parseEpisodeNumber(undefined, "#7 Lucky Seven")).toBe(7);
		expect(parseEpisodeNumber("", "Episode 88: Hello")).toBe(88);
		expect(parseEpisodeNumber("not-a-number", "12 - Topic")).toBe(12);
	});

	it("returns undefined when no number can be found", () => {
		expect(parseEpisodeNumber(undefined, "A Title With No Number")).toBeUndefined();
		expect(parseEpisodeNumber(null, null)).toBeUndefined();
		expect(parseEpisodeNumber("", "")).toBeUndefined();
	});

	it("rejects an <itunes:episode> value that would lose integer precision", () => {
		// 21 digits -> 1e+21; must not leak "1e+21" into a file name.
		expect(parseEpisodeNumber("999999999999999999999", "no title number")).toBeUndefined();
		// Just past Number.MAX_SAFE_INTEGER.
		expect(parseEpisodeNumber("9007199254740993", "no title number")).toBeUndefined();
	});
});

describe("parseEpisodeNumberFromTitle", () => {
	it("reads a leading hash marker", () => {
		expect(parseEpisodeNumberFromTitle("#15 The Big One")).toBe(15);
		expect(parseEpisodeNumberFromTitle("# 15 The Big One")).toBe(15);
	});

	it("reads Ep/Episode/E markers", () => {
		expect(parseEpisodeNumberFromTitle("Ep 9 Something")).toBe(9);
		expect(parseEpisodeNumberFromTitle("Ep. 9 Something")).toBe(9);
		expect(parseEpisodeNumberFromTitle("Ep #9 Something")).toBe(9);
		expect(parseEpisodeNumberFromTitle("Episode 123: Deep Dive")).toBe(123);
		expect(parseEpisodeNumberFromTitle("E45 - Highlights")).toBe(45);
	});

	it("reads a leading number followed by a separator", () => {
		expect(parseEpisodeNumberFromTitle("412: The Topic")).toBe(412);
		expect(parseEpisodeNumberFromTitle("7 - Lucky")).toBe(7);
		expect(parseEpisodeNumberFromTitle("7. Lucky")).toBe(7);
		expect(parseEpisodeNumberFromTitle("7) Lucky")).toBe(7);
	});

	it("does not pick up unrelated numbers", () => {
		// No leading marker and no separator after the number.
		expect(parseEpisodeNumberFromTitle("Top 10 Mistakes")).toBeUndefined();
		expect(parseEpisodeNumberFromTitle("10 Reasons To Subscribe")).toBeUndefined();
		expect(parseEpisodeNumberFromTitle("Windows 11 Review")).toBeUndefined();
		expect(parseEpisodeNumberFromTitle("Everything Is Fine")).toBeUndefined();
	});

	it("does not misread a leading decimal as an integer", () => {
		// A "." only separates when not followed by a digit, so "10.5" is not 10.
		expect(parseEpisodeNumberFromTitle("10.5 The Bonus")).toBeUndefined();
		expect(parseEpisodeNumberFromTitle("10.5: The Bonus")).toBeUndefined();
		// But "7." (separator, no following digit) still works.
		expect(parseEpisodeNumberFromTitle("7. Lucky")).toBe(7);
	});

	it("does not misread a decimal after a label marker", () => {
		expect(parseEpisodeNumberFromTitle("Ep 10.5 The Bonus")).toBeUndefined();
		expect(parseEpisodeNumberFromTitle("Episode 10.5: The Bonus")).toBeUndefined();
		expect(parseEpisodeNumberFromTitle("#10.5 Bonus")).toBeUndefined();
		expect(parseEpisodeNumberFromTitle("E10.5 Bonus")).toBeUndefined();
		// A whole number after a marker still resolves.
		expect(parseEpisodeNumberFromTitle("Ep 10 The Whole One")).toBe(10);
	});

	it("stays linear on hostile, very long whitespace titles (ReDoS regression)", () => {
		// Before the fix this took ~20s; bounding the prefix + a single \s* keeps
		// it instant. Asserting completion is enough; correctness is undefined.
		const hostile = `Ep${" ".repeat(200000)}x`;
		const start = performance.now();
		expect(parseEpisodeNumberFromTitle(hostile)).toBeUndefined();
		expect(performance.now() - start).toBeLessThan(1000);
	});
});
