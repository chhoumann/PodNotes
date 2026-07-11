import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChapters } from "./fetchChapters";

const mockFetchTextWithTimeout = vi.hoisted(() => vi.fn());

vi.mock("./networkRequest", () => ({
	fetchTextWithTimeout: mockFetchTextWithTimeout,
}));

describe("fetchChapters", () => {
	beforeEach(() => {
		mockFetchTextWithTimeout.mockReset();
	});

	it("normalizes malformed chapter entries instead of returning raw JSON", async () => {
		mockFetchTextWithTimeout.mockResolvedValue(
			JSON.stringify({
				version: "1.2.0",
				chapters: [
					{ startTime: 65, title: "Deep Dive" },
					{ startTime: 35 },
					{ startTime: 30, title: null },
					{ startTime: Number.NaN, title: "Bad time" },
					{ startTime: 10, title: "Hidden", toc: false },
					{ startTime: 0, title: "Intro" },
				],
			}),
		);

		await expect(fetchChapters("https://example.com/chapters.json")).resolves.toEqual([
			{ startTime: 0, title: "Intro" },
			{ startTime: 35, title: "" },
			{ startTime: 65, title: "Deep Dive" },
		]);
		expect(mockFetchTextWithTimeout).toHaveBeenCalledWith("https://example.com/chapters.json", {
			timeoutMs: 10_000,
			maxResponseBytes: 4_000_000,
			acceptedStatuses: [200],
		});
	});

	it("lets the shared request boundary reject unsupported chapter URL protocols", async () => {
		mockFetchTextWithTimeout.mockRejectedValue(
			new Error("Network request target is not allowed."),
		);

		await expect(fetchChapters("file:///tmp/chapters.json")).resolves.toEqual([]);
		expect(mockFetchTextWithTimeout).toHaveBeenCalledOnce();
	});

	it("ignores oversized chapter payloads", async () => {
		mockFetchTextWithTimeout.mockResolvedValue(" ".repeat(1_000_001));

		await expect(fetchChapters("https://example.com/chapters.json")).resolves.toEqual([]);
	});
});
