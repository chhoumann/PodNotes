import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import searchAppleNews from "../tests/fixtures/itunes/search-apple-news.json";
import { fetchJsonWithTimeout, NetworkError } from "./utility/networkRequest";
import { queryiTunesPodcasts } from "./iTunesAPIConsumer";

vi.mock("./utility/networkRequest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./utility/networkRequest")>();
	return { ...actual, fetchJsonWithTimeout: vi.fn() };
});

const fetchJsonMock = vi.mocked(fetchJsonWithTimeout);

function requestedUrl(): URL {
	return new URL(fetchJsonMock.mock.calls[0][0]);
}

beforeEach(() => {
	fetchJsonMock.mockReset();
	vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

describe("queryiTunesPodcasts", () => {
	it("asks for 20 shows through a bounded request", async () => {
		fetchJsonMock.mockResolvedValue(searchAppleNews);

		await queryiTunesPodcasts("apple news");

		const url = requestedUrl();
		expect(url.origin + url.pathname).toBe("https://itunes.apple.com/search");
		expect(url.searchParams.get("term")).toBe("apple news");
		expect(url.searchParams.get("limit")).toBe("20");
		expect(fetchJsonMock).toHaveBeenCalledWith(expect.any(String), {
			timeoutMs: 15_000,
			maxResponseBytes: 2 * 1024 * 1024,
			acceptedStatuses: [200],
		});
	});

	it("maps shows to feeds and drops shows without a public RSS feed", async () => {
		// The first result, Apple News Today, is Apple-hosted and has no feedUrl.
		fetchJsonMock.mockResolvedValue(searchAppleNews);

		await expect(queryiTunesPodcasts("apple news")).resolves.toEqual([
			{
				title: "Apple News In Conversation",
				url: "https://apple.news/podcast/apple_news_in_conversation",
				artworkUrl:
					"https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/21/e5/93/21e59350-3d63-8dfb-f8a1-c762f85e069c/mza_13661945558824532647.jpg/100x100bb.jpg",
				collectionId: "1577591053",
			},
			{
				title: "Apple Quarterly Earnings Call",
				url: "https://rss.art19.com/apple-quarterly-earnings-call",
				artworkUrl:
					"https://is1-ssl.mzstatic.com/image/thumb/Podcasts211/v4/72/23/72/72237247-8b65-6174-8aa2-0a3691352b02/mza_5761462598177267980.jpeg/100x100bb.jpg",
				collectionId: "74942331",
			},
		]);
	});

	it("turns an invalid response shape into a redacted boundary error", async () => {
		const marker = "private-query-value";
		fetchJsonMock.mockResolvedValue({ results: null } as never);

		const error = await queryiTunesPodcasts(marker).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(NetworkError);
		expect((error as NetworkError).code).toBe("invalid-response");
		expect(String(error)).not.toContain(marker);
		expect(console.error).toHaveBeenCalledWith(
			"iTunes request failed.",
			"invalid-response",
			undefined,
		);
	});
});
