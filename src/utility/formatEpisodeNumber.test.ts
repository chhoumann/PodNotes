import { describe, expect, it } from "vitest";
import { formatEpisodeNumber } from "./formatEpisodeNumber";

describe("formatEpisodeNumber", () => {
	it("renders the bare number", () => {
		expect(formatEpisodeNumber(42)).toBe("42");
		expect(formatEpisodeNumber(0)).toBe("0");
	});

	it("zero-pads to an all-zeros width", () => {
		expect(formatEpisodeNumber(42, "000")).toBe("042");
		expect(formatEpisodeNumber(5, "0000")).toBe("0005");
		// Does not truncate when the value is wider than the pad.
		expect(formatEpisodeNumber(12345, "00")).toBe("12345");
	});

	it("ignores non-all-zeros format arguments (returns the bare number)", () => {
		expect(formatEpisodeNumber(42, "3")).toBe("42");
		expect(formatEpisodeNumber(42, "###")).toBe("42");
		expect(formatEpisodeNumber(42, "")).toBe("42");
	});

	it("renders empty when the number is undefined", () => {
		expect(formatEpisodeNumber(undefined)).toBe("");
		expect(formatEpisodeNumber(undefined, "000")).toBe("");
	});
});
