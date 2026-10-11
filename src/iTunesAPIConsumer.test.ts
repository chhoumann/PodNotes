import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import lookupAppleIncArtist from "../tests/fixtures/itunes/lookup-apple-inc-artist.json";
import lookupAppleNewsToday from "../tests/fixtures/itunes/lookup-apple-news-today.json";
import lookupHubermanLab from "../tests/fixtures/itunes/lookup-huberman-lab.json";
import lookupUnknownId from "../tests/fixtures/itunes/lookup-unknown-id.json";
import searchAppleNews from "../tests/fixtures/itunes/search-apple-news.json";
import searchPlanetMoney from "../tests/fixtures/itunes/search-planet-money.json";
import { fetchJsonWithTimeout, NetworkError } from "./utility/networkRequest";
import {
	lookupiTunesPodcast,
	parseApplePodcastsId,
	queryiTunesPodcasts,
} from "./iTunesAPIConsumer";

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

	it("lists each feed once, under its best-ranked show", async () => {
		// Planet Money's feed comes back as three shows: ranks 1, 4, and 5.
		fetchJsonMock.mockResolvedValue(searchPlanetMoney);

		const feeds = await queryiTunesPodcasts("planet money");

		expect(feeds.map(({ collectionId, url }) => [collectionId, url])).toEqual([
			["290783428", "https://feeds.npr.org/510289/podcast.xml"],
			["1320118593", "https://feeds.npr.org/510325/podcast.xml"],
			["1578892272", "https://feeds.npr.org/510362/podcast.xml"],
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

describe("parseApplePodcastsId", () => {
	it.each([
		["https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110", "1545953110"],
		["https://podcasts.apple.com/podcast/huberman-lab/id1545953110", "1545953110"],
		["https://podcasts.apple.com/us/podcast/id1545953110", "1545953110"],
		["https://podcasts.apple.com/us/podcast/id10/id1545953110", "1545953110"],
		["https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110?uo=4", "1545953110"],
		[
			"https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110?i=1000650000000",
			"1545953110",
		],
		["https://podcasts.apple.com/us/podcast/ideas/id151485663?uo=4", "151485663"],
		["  https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110\n", "1545953110"],
		["http://podcasts.apple.com/us/podcast/huberman-lab/id1545953110", "1545953110"],
		["https://itunes.apple.com/us/podcast/huberman-lab/id1545953110?mt=2", "1545953110"],
		[
			"https://itunes.apple.com/WebObjects/MZStore.woa/wa/viewPodcast?id=1545953110",
			"1545953110",
		],
		["https://podcasts.apple.com/podcast?id=1545953110", "1545953110"],
	])("reads the show id from %s", (input, id) => {
		expect(parseApplePodcastsId(input)).toBe(id);
	});

	it.each([
		"https://podcasts.apple.com.evil.example/us/podcast/huberman-lab/id1545953110",
		"https://evil.example/us/podcast/huberman-lab/id1545953110",
		"ftp://podcasts.apple.com/us/podcast/huberman-lab/id1545953110",
		"podcasts://podcasts.apple.com/us/podcast/huberman-lab/id1545953110",
		"https://podcasts.apple.com/us/channel/scicomm-media/id6442692632",
		"https://podcasts.apple.com/us/podcast/huberman-lab",
		"https://podcasts.apple.com/us/podcast/huberman-lab/idhuberman",
		"https://podcasts.apple.com/podcast?id=huberman",
		"https://podcasts.apple.com/us/browse?id=1545953110",
		"https://feeds.megaphone.fm/hubermanlab",
		"huberman lab",
	])("rejects %s", (input) => {
		expect(parseApplePodcastsId(input)).toBeNull();
	});
});

describe("lookupiTunesPodcast", () => {
	it("resolves a show id to its RSS feed through a bounded request", async () => {
		fetchJsonMock.mockResolvedValue(lookupHubermanLab);

		await expect(lookupiTunesPodcast("1545953110")).resolves.toEqual({
			title: "Huberman Lab",
			url: "https://feeds.megaphone.fm/hubermanlab",
			artworkUrl:
				"https://is1-ssl.mzstatic.com/image/thumb/Podcasts221/v4/9a/d3/19/9ad31912-0b5a-a16e-2d7c-9fd074698b9c/mza_8994222203629500925.jpg/100x100bb.jpg",
			collectionId: "1545953110",
		});
		const url = requestedUrl();
		expect(url.origin + url.pathname).toBe("https://itunes.apple.com/lookup");
		expect(url.searchParams.get("id")).toBe("1545953110");
		expect(url.searchParams.get("entity")).toBe("podcast");
		expect(fetchJsonMock).toHaveBeenCalledWith(expect.any(String), {
			timeoutMs: 15_000,
			maxResponseBytes: 2 * 1024 * 1024,
			acceptedStatuses: [200],
		});
	});

	it("returns null for an id Apple does not know", async () => {
		fetchJsonMock.mockResolvedValue(lookupUnknownId);

		await expect(lookupiTunesPodcast("1")).resolves.toBeNull();
	});

	it("returns null for an artist id instead of one of the artist's shows", async () => {
		fetchJsonMock.mockResolvedValue(lookupAppleIncArtist);

		await expect(lookupiTunesPodcast("706424103")).resolves.toBeNull();
	});

	it("returns null for a show without a public RSS feed", async () => {
		fetchJsonMock.mockResolvedValue(lookupAppleNewsToday);

		await expect(lookupiTunesPodcast("1473872585")).resolves.toBeNull();
	});

	it("rejects on a failed request instead of reporting a missing feed", async () => {
		fetchJsonMock.mockRejectedValue(new NetworkError("timeout"));

		await expect(lookupiTunesPodcast("1545953110")).rejects.toMatchObject({ code: "timeout" });
	});
});
