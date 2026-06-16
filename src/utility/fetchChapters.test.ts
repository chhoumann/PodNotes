import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChapters } from "./fetchChapters";

const mockRequestWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("./networkRequest", () => ({
	requestWithTimeout: mockRequestWithTimeout,
}));

describe("fetchChapters", () => {
	beforeEach(() => {
		mockRequestWithTimeout.mockReset();
	});

	it("normalizes malformed chapter entries instead of returning raw JSON", async () => {
		mockRequestWithTimeout.mockResolvedValue({
			text: JSON.stringify({
				version: "1.2.0",
				chapters: [
					{ startTime: 65, title: "Deep Dive" },
					{ startTime: 0 },
					{ startTime: 30, title: null },
					{ startTime: Number.NaN, title: "Bad time" },
					{ startTime: 10, title: "Hidden", toc: false },
					{ startTime: 0, title: "Intro" },
				],
			}),
		});

		await expect(
			fetchChapters("https://example.com/chapters.json"),
		).resolves.toEqual([
			{ startTime: 0, title: "Intro" },
			{ startTime: 65, title: "Deep Dive" },
		]);
	});

	it("ignores unsupported chapter URL protocols", async () => {
		await expect(fetchChapters("file:///tmp/chapters.json")).resolves.toEqual([]);
		expect(mockRequestWithTimeout).not.toHaveBeenCalled();
	});

	it("ignores oversized chapter payloads", async () => {
		mockRequestWithTimeout.mockResolvedValue({
			text: " ".repeat(1_000_001),
		});

		await expect(
			fetchChapters("https://example.com/chapters.json"),
		).resolves.toEqual([]);
	});
});
