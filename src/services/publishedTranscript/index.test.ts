import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ParsedEpisodeDocument, TranscriptLink } from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { NetworkError } from "src/utility/networkRequest";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { MemoryStorage, stubLegacyStorage } from "../../../tests/mocks/feeds";
import { transcriptFixture } from "../../../tests/mocks/transcriptFixtures";
import {
	choosePublishedTranscript,
	fetchPublishedTranscript,
	findPublishedTranscript,
	PublishedTranscriptError,
} from "./index";

const fetchTextMock = vi.hoisted(() => vi.fn());

vi.mock("src/utility/networkRequest", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/utility/networkRequest")>()),
	fetchTextWithTimeout: fetchTextMock,
}));

const SECRET_URL = "https://private.test/s3cret/feed.xml?auth=s3cret";
const show: PodcastFeed = { title: "Show", url: "https://show.test/feed.xml", artworkUrl: "" };
const hidden: PodcastFeed = {
	title: "Hidden",
	url: privateFeedPlaceholder("Hidden"),
	urlSecretId: "hidden-secret",
	artworkUrl: "",
};

function item(transcripts: TranscriptLink[], number = 1): ParsedEpisodeDocument {
	return {
		title: `Episode ${number}`,
		streamUrl: `https://media.test/${number}.mp3`,
		description: "",
		content: "",
		episodeDate: new Date(Date.UTC(2026, 0, number)),
		mediaType: "audio",
		transcripts,
	};
}

function episodeOf(feed: PodcastFeed, number = 1): Episode {
	return {
		title: `Episode ${number}`,
		streamUrl: `https://media.test/${number}.mp3`,
		url: "",
		description: "",
		content: "",
		podcastName: feed.title,
		feedUrl: feed.url,
	};
}

function repository(items: ParsedEpisodeDocument[], storage = new MemoryStorage()) {
	const load = vi.fn(async () => ({ feed: { title: "Channel" }, episodes: items }));
	const feeds = new FeedRepository({
		load,
		resolveUrl: (feed) => (feed.urlSecretId ? SECRET_URL : feed.url),
		storage,
		cache: () => ({ enabled: true, ttlHours: 6 }),
		now: () => Date.UTC(2026, 9, 12),
	});
	feeds.setSubscriptions({ Show: show, Hidden: hidden });
	return { feeds, load, storage };
}

beforeEach(() => {
	stubLegacyStorage();
	fetchTextMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("choosePublishedTranscript", () => {
	test("prefers VTT, then SRT, JSON, HTML and text, and the first link on a tie", () => {
		const links = [
			{ url: "t.txt", type: "text/plain" },
			{ url: "t.html", type: "text/html" },
			{ url: "t.json", type: "application/json" },
			{ url: "t.srt", type: "application/srt" },
			{ url: "first.vtt", type: "text/vtt" },
			{ url: "second.vtt", type: "text/vtt" },
		];

		expect(choosePublishedTranscript("Show", links)).toEqual({
			key: "Show",
			reference: "first.vtt",
			format: "vtt",
		});
		expect(choosePublishedTranscript("Show", links.slice(0, 4))).toMatchObject({
			reference: "t.srt",
			format: "srt",
		});
		expect(choosePublishedTranscript("Show", links.slice(0, 2))).toMatchObject({
			format: "html",
		});
	});

	test("never chooses a link whose type is unknown or missing", () => {
		expect(
			choosePublishedTranscript("Show", [
				{ url: "t.bin", type: "application/octet-stream" },
				{ url: "t.vtt" },
			]),
		).toBeUndefined();
	});

	test("skips malformed cached entries and reads a type with parameters", () => {
		expect(
			choosePublishedTranscript("Show", [
				null,
				"t.vtt",
				{ url: 7, type: "text/vtt" },
				{ url: "t.srt", type: ["application/srt"] },
				{ url: "t.txt", type: " Text/Plain; charset=utf-8" },
			]),
		).toEqual({ key: "Show", reference: "t.txt", format: "text" });
		expect(
			choosePublishedTranscript("Show", { url: "t.vtt", type: "text/vtt" }),
		).toBeUndefined();
	});
});

describe("findPublishedTranscript", () => {
	test("loads the episode's feed itself when nothing has loaded it yet", async () => {
		const { feeds, load } = repository([item([{ url: "t.vtt", type: "text/vtt" }])]);

		await expect(findPublishedTranscript(feeds, episodeOf(show))).resolves.toEqual({
			key: "Show",
			reference: "t.vtt",
			format: "vtt",
		});
		expect(load).toHaveBeenCalledOnce();
	});

	test("finds a newer episode in a cached feed cut to its newest items without fetching it", async () => {
		const storage = new MemoryStorage();
		const items = Array.from({ length: 76 }, (_, index) =>
			item(index === 75 ? [{ url: "t.vtt", type: "text/vtt" }] : [], index + 1),
		);
		await repository(items, storage).feeds.load(["Show"], "network");

		const { feeds, load } = repository(items, storage);

		await expect(findPublishedTranscript(feeds, episodeOf(show, 76))).resolves.toMatchObject({
			reference: "t.vtt",
		});
		expect(load).not.toHaveBeenCalled();
	});

	test("refetches a cached feed cut to its newest items to find an older episode", async () => {
		const storage = new MemoryStorage();
		const newest = Array.from({ length: 75 }, (_, index) => item([], index + 2));
		const older = item([{ url: "t.vtt", type: "text/vtt" }], 1);
		const seeded = repository([...newest, older], storage);
		await seeded.feeds.load(["Show"], "network");

		const { feeds, load } = repository([...newest, older], storage);

		await expect(findPublishedTranscript(feeds, episodeOf(show, 1))).resolves.toMatchObject({
			reference: "t.vtt",
		});
		expect(load).toHaveBeenCalledOnce();
	});

	test("finds nothing for a local file or an episode of an unsubscribed feed", async () => {
		const { feeds, load } = repository([item([{ url: "t.vtt", type: "text/vtt" }])]);

		await expect(
			findPublishedTranscript(feeds, { ...episodeOf(show), podcastName: "local file" }),
		).resolves.toBeUndefined();
		await expect(
			findPublishedTranscript(feeds, { ...episodeOf(show), podcastName: "Elsewhere" }),
		).resolves.toBeUndefined();
		expect(load).not.toHaveBeenCalled();
	});
});

describe("fetchPublishedTranscript", () => {
	const signal = new AbortController().signal;

	test("fetches the link resolved against the feed, once, within the transcript limits", async () => {
		const { feeds } = repository([]);
		fetchTextMock.mockResolvedValue(transcriptFixture("build-your-saas.vtt"));

		const transcript = await fetchPublishedTranscript(
			feeds,
			{ key: "Show", reference: "transcripts/1.vtt", format: "vtt" },
			signal,
		);

		expect(transcript.kind).toBe("timed");
		expect(fetchTextMock).toHaveBeenCalledExactlyOnceWith(
			"https://show.test/transcripts/1.vtt",
			{
				timeoutMs: 30_000,
				maxResponseBytes: 16 * 1024 * 1024,
				acceptedStatuses: [200],
				signal,
			},
		);
	});

	test("a failed request says why without its URL", async () => {
		const { feeds } = repository([]);
		fetchTextMock.mockRejectedValue(new NetworkError("unexpected-status", 404));

		await expect(
			fetchPublishedTranscript(
				feeds,
				{ key: "Hidden", reference: "1.vtt", format: "vtt" },
				signal,
			),
		).rejects.toThrow(
			new PublishedTranscriptError(
				"The published transcript could not be fetched: Network response returned HTTP 404.",
			),
		);
		expect(fetchTextMock).toHaveBeenCalledWith(
			"https://private.test/s3cret/1.vtt",
			expect.anything(),
		);
	});

	test("an aborted request rejects with the abort, not a transcript error", async () => {
		const { feeds } = repository([]);
		const controller = new AbortController();
		const abort = new NetworkError("aborted");
		fetchTextMock.mockImplementation(async () => {
			controller.abort();
			throw abort;
		});

		await expect(
			fetchPublishedTranscript(
				feeds,
				{ key: "Show", reference: "1.vtt", format: "vtt" },
				controller.signal,
			),
		).rejects.toBe(abort);
	});

	test("text that is not the declared format cannot be read", async () => {
		const { feeds } = repository([]);
		fetchTextMock.mockResolvedValue("<html>Sign in to read the transcript</html>");

		await expect(
			fetchPublishedTranscript(
				feeds,
				{ key: "Show", reference: "1.json", format: "json" },
				signal,
			),
		).rejects.toThrow(
			new PublishedTranscriptError("The published transcript could not be read."),
		);
	});

	test("a relative link has no address when the feed is not subscribed", async () => {
		const { feeds } = repository([]);

		await expect(
			fetchPublishedTranscript(
				feeds,
				{ key: "Gone", reference: "1.vtt", format: "vtt" },
				signal,
			),
		).rejects.toThrow(
			new PublishedTranscriptError(
				"The published transcript could not be fetched: its address is not valid.",
			),
		);
		expect(fetchTextMock).not.toHaveBeenCalled();
	});

	test("the feed cache keeps the link as published, never the private feed's URL", async () => {
		const { feeds, storage } = repository([item([{ url: "1.vtt", type: "text/vtt" }])]);
		fetchTextMock.mockResolvedValue(transcriptFixture("build-your-saas.vtt"));

		const source = await findPublishedTranscript(feeds, episodeOf(hidden));
		await fetchPublishedTranscript(feeds, source!, signal);

		const stored = [...storage.values.values()].map(String).join("\n");
		expect(stored).toContain('"url":"1.vtt"');
		expect(stored).not.toContain("s3cret");
		expect(fetchTextMock).toHaveBeenCalledWith(
			"https://private.test/s3cret/1.vtt",
			expect.anything(),
		);
	});
});
