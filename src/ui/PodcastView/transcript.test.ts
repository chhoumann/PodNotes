import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ParsedEpisodeDocument, TranscriptLink } from "src/parser/feedDocumentParser";
import { FeedRepository } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import { NetworkError } from "src/utility/networkRequest";
import { MemoryStorage, stubLegacyStorage } from "../../../tests/mocks/feeds";
import { transcriptFixture } from "../../../tests/mocks/transcriptFixtures";
import { cachedTranscript, lineAt, loadTranscript } from "./transcript";

const fetchTextMock = vi.hoisted(() => vi.fn());

vi.mock("src/utility/networkRequest", async (importOriginal) => ({
	...(await importOriginal<typeof import("src/utility/networkRequest")>()),
	fetchTextWithTimeout: fetchTextMock,
}));

const signal = new AbortController().signal;

function episode(number: number, transcripts: TranscriptLink[] = []) {
	const item: ParsedEpisodeDocument = {
		title: `Episode ${number}`,
		streamUrl: `https://media.test/${number}.mp3`,
		description: "",
		content: "",
		episodeDate: new Date(Date.UTC(2026, 0, number)),
		mediaType: "audio",
		transcripts,
	};
	const played: Episode = {
		title: item.title,
		streamUrl: item.streamUrl,
		url: "",
		description: "",
		content: "",
		podcastName: "Show",
		feedUrl: "https://show.test/feed.xml",
	};
	return { item, played };
}

function repository(items: ParsedEpisodeDocument[]) {
	const load = vi.fn(async () => ({ feed: { title: "Show" }, episodes: items }));
	const feeds = new FeedRepository({
		load,
		resolveUrl: (feed) => feed.url,
		storage: new MemoryStorage(),
		now: () => Date.UTC(2026, 9, 12),
	});
	feeds.setSubscriptions({
		Show: { title: "Show", url: "https://show.test/feed.xml", artworkUrl: "" },
	});
	return { feeds, load };
}

const vtt = (...cues: string[]) =>
	`WEBVTT\n\n${cues.map((cue, index) => `00:00:0${index}.000 --> 00:00:0${index + 1}.000\n${cue}`).join("\n\n")}\n`;

beforeEach(() => {
	stubLegacyStorage();
	fetchTextMock.mockReset();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("lineAt", () => {
	test("is the last line to start at or before the time, and -1 before the first", () => {
		const lines = [{ start: 2 }, { start: 6 }, { start: 12 }];

		expect([1, 2, 11.9, 12, 500].map((time) => lineAt(lines, time))).toEqual([-1, 0, 1, 2, 2]);
	});
});

describe("loadTranscript", () => {
	test("merges a word-level transcript into sentence lines a tap can land in", async () => {
		const { item, played } = episode(1, [{ url: "1.json", type: "application/json" }]);
		const { feeds } = repository([item]);
		fetchTextMock.mockResolvedValue(transcriptFixture("buzzcast.json"));

		const transcript = await loadTranscript(feeds, played, signal);

		expect(transcript?.kind).toBe("timed");
		expect(transcript?.lines.slice(0, 3)).toEqual([
			{
				start: 0.16,
				end: 15.04,
				speaker: "Alban",
				text: "Moments ago, I just hit a professional milestone, a new accomplishment. All right, I'm gonna be using air quotes for this, but the first code that I ever wrote, and I'm now using air quotes for I wrote is now live in Buzzsprout as of like four minutes ago.",
			},
			{
				start: 15.2,
				end: 17.28,
				speaker: "Kevin",
				text: "Oh, your PR got accepted and merged?",
			},
			{ start: 17.44, end: 18.32, speaker: "Alban", text: "It's merged." },
		]);
		expect(fetchTextMock).toHaveBeenCalledWith("https://show.test/1.json", expect.anything());
	});

	test("an untimed transcript is its paragraphs", async () => {
		const { item, played } = episode(2, [{ url: "2.txt", type: "text/plain" }]);
		const { feeds } = repository([item]);
		fetchTextMock.mockResolvedValue("First paragraph.\n\nSecond paragraph.");

		await expect(loadTranscript(feeds, played, signal)).resolves.toEqual({
			kind: "untimed",
			lines: [{ text: "First paragraph." }, { text: "Second paragraph." }],
		});
	});

	test("a feed without a transcript is none, and stays known as none", async () => {
		const { item, played } = episode(3);
		const { feeds, load } = repository([item]);

		expect(cachedTranscript(played)).toBeUndefined();
		await expect(loadTranscript(feeds, played, signal)).resolves.toBeNull();

		expect(cachedTranscript(played)).toBeNull();
		expect(load).toHaveBeenCalledOnce();
		expect(fetchTextMock).not.toHaveBeenCalled();
	});

	test("keeps one episode: loading another replaces it", async () => {
		const first = episode(4, [{ url: "4.vtt", type: "text/vtt" }]);
		const second = episode(5);
		const { feeds } = repository([first.item, second.item]);
		fetchTextMock.mockResolvedValue(vtt("Only line."));

		const loaded = await loadTranscript(feeds, first.played, signal);
		expect(cachedTranscript(first.played)).toBe(loaded);
		await loadTranscript(feeds, second.played, signal);

		expect(cachedTranscript(first.played)).toBeUndefined();
		expect(cachedTranscript(second.played)).toBeNull();
	});

	test("a transcript that failed to load is not kept, so the next load fetches it again", async () => {
		const { item, played } = episode(6, [{ url: "6.vtt", type: "text/vtt" }]);
		const { feeds } = repository([item]);
		fetchTextMock.mockRejectedValueOnce(new NetworkError("unexpected-status", 500));
		fetchTextMock.mockResolvedValueOnce(vtt("Back again."));

		await expect(loadTranscript(feeds, played, signal)).rejects.toThrow(
			"The published transcript could not be fetched",
		);
		expect(cachedTranscript(played)).toBeUndefined();

		await expect(loadTranscript(feeds, played, signal)).resolves.toEqual({
			kind: "timed",
			lines: [{ start: 0, end: 1, speaker: undefined, text: "Back again." }],
		});
		expect(fetchTextMock).toHaveBeenCalledTimes(2);
	});

	test("a feed that did not load fails rather than reporting no transcript", async () => {
		const { item, played } = episode(7, [{ url: "7.vtt", type: "text/vtt" }]);
		const { feeds, load } = repository([item]);
		load.mockRejectedValueOnce(new Error("offline"));

		await expect(loadTranscript(feeds, played, signal)).rejects.toThrow();
		expect(cachedTranscript(played)).toBeUndefined();

		fetchTextMock.mockResolvedValue(vtt("Found once the feed loads."));
		await expect(loadTranscript(feeds, played, signal)).resolves.toMatchObject({
			kind: "timed",
		});
	});
});
