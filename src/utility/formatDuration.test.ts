import { describe, expect, it } from "vitest";
import { formatDuration } from "./formatDuration";

describe("formatDuration", () => {
	it("renders a clock without hours for short episodes", () => {
		expect(formatDuration(270)).toBe("4:30");
		expect(formatDuration(65)).toBe("1:05");
		expect(formatDuration(5)).toBe("0:05");
	});

	it("includes the hours segment for episodes of an hour or more", () => {
		expect(formatDuration(3723)).toBe("1:02:03");
		expect(formatDuration(3600)).toBe("1:00:00");
	});

	it("supports the minutes keyword (total whole minutes, floored)", () => {
		expect(formatDuration(3723, "minutes")).toBe("62");
		expect(formatDuration(59, "minutes")).toBe("0");
		expect(formatDuration(3723, "MINUTES")).toBe("62");
	});

	it("supports the seconds keyword (total seconds)", () => {
		expect(formatDuration(3723, "seconds")).toBe("3723");
	});

	it("passes other formats through to formatSeconds tokens", () => {
		expect(formatDuration(3723, "HH:mm:ss")).toBe("01:02:03");
		expect(formatDuration(270, "mm:ss")).toBe("04:30");
	});
});
