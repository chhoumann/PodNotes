import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJsonWithTimeout, NetworkError } from "./utility/networkRequest";
import { queryiTunesPodcasts } from "./iTunesAPIConsumer";

vi.mock("./utility/networkRequest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./utility/networkRequest")>();
	return { ...actual, fetchJsonWithTimeout: vi.fn() };
});

const fetchJsonMock = vi.mocked(fetchJsonWithTimeout);

describe("queryiTunesPodcasts", () => {
	beforeEach(() => {
		fetchJsonMock.mockReset();
		vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => vi.restoreAllMocks());

	it("uses a bounded request and projects search results", async () => {
		fetchJsonMock.mockResolvedValue({
			results: [
				{
					collectionName: "Example Show",
					feedUrl: "https://feeds.example.com/show.xml",
					artworkUrl100: "https://images.example.com/show.jpg",
					collectionId: "123",
				},
			],
		});

		await expect(queryiTunesPodcasts("example & show")).resolves.toEqual([
			{
				title: "Example Show",
				url: "https://feeds.example.com/show.xml",
				artworkUrl: "https://images.example.com/show.jpg",
				collectionId: "123",
			},
		]);
		expect(fetchJsonMock).toHaveBeenCalledWith(
			expect.stringMatching(/^https:\/\/itunes\.apple\.com\/search\?/),
			{
				timeoutMs: 15_000,
				maxResponseBytes: 2 * 1024 * 1024,
				acceptedStatuses: [200],
			},
		);
	});

	it("turns an invalid response shape into a redacted boundary error", async () => {
		const marker = "private-query-value";
		fetchJsonMock.mockResolvedValue({ results: null } as never);

		const error = await queryiTunesPodcasts(marker).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NetworkError);
		expect((error as NetworkError).code).toBe("invalid-response");
		expect(String(error)).not.toContain(marker);
		expect(console.error).toHaveBeenCalledWith(
			"iTunes search failed.",
			"invalid-response",
			undefined,
		);
	});
});
