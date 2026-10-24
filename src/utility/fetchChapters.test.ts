import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchChapters } from "./fetchChapters";

const mockFetchTextWithTimeout = vi.hoisted(() => vi.fn());
const mockFetchId3Chapters = vi.hoisted(() => vi.fn());

vi.mock("./networkRequest", () => ({
	fetchTextWithTimeout: mockFetchTextWithTimeout,
}));
vi.mock("./id3Chapters", () => ({ fetchId3Chapters: mockFetchId3Chapters }));

const json = (chaptersUrl: string) => ({
	chaptersUrl,
	streamUrl: "https://example.com/episode.mp3",
});

describe("fetchChapters", () => {
	beforeEach(() => {
		mockFetchTextWithTimeout.mockReset();
		mockFetchId3Chapters.mockReset();
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

		await expect(fetchChapters(json("https://example.com/chapters.json"))).resolves.toEqual([
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

		await expect(fetchChapters(json("file:///tmp/chapters.json"))).resolves.toBeUndefined();
		expect(mockFetchTextWithTimeout).toHaveBeenCalledOnce();
	});

	it("ignores oversized chapter payloads", async () => {
		mockFetchTextWithTimeout.mockResolvedValue(" ".repeat(1_000_001));

		await expect(fetchChapters(json("https://example.com/chapters.json"))).resolves.toEqual([]);
	});

	it("reads the media's ID3 chapters when the feed names no chapters file", async () => {
		const id3 = [{ startTime: 0, title: "Intro" }];
		mockFetchId3Chapters.mockResolvedValue(id3);

		await expect(
			fetchChapters({ streamUrl: "https://example.com/episode.mp3" }),
		).resolves.toEqual(id3);
		await expect(
			fetchChapters({ streamUrl: "app://local/vault/Episode.mp3" }),
		).resolves.toEqual([]);
		expect(mockFetchId3Chapters).toHaveBeenCalledExactlyOnceWith(
			"https://example.com/episode.mp3",
		);
		expect(mockFetchTextWithTimeout).not.toHaveBeenCalled();
	});
});
