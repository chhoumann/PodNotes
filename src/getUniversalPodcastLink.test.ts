import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { requestUrl } from "obsidian";

import getUniversalPodcastLink from "./getUniversalPodcastLink";
import { queryiTunesPodcasts } from "./iTunesAPIConsumer";
import { savedFeeds } from "./store";
import type { IAPI } from "./API/IAPI";
import type { Episode } from "./types/Episode";

const noticeSpy = vi.fn();

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return {
		...actual,
		requestUrl: vi.fn(),
		// A spy class so we can assert which user-facing messages were shown.
		Notice: class {
			message?: string;
			constructor(message?: string) {
				this.message = message;
				noticeSpy(message);
			}
			hide(): void {}
		},
	};
});

vi.mock("./iTunesAPIConsumer", () => ({
	queryiTunesPodcasts: vi.fn(),
}));

const requestUrlMock = vi.mocked(requestUrl);
const queryiTunesMock = vi.mocked(queryiTunesPodcasts);

const podcast: Episode = {
	title: "Episode One",
	streamUrl: "https://feeds.example.com/ep1.mp3",
	url: "https://feeds.example.com/ep1",
	description: "",
	content: "",
	podcastName: "Example Show",
	feedUrl: "https://feeds.example.com/rss",
};

const api = { podcast } as unknown as IAPI;

function noticeMessages(): (string | undefined)[] {
	return noticeSpy.mock.calls.map((call) => call[0] as string | undefined);
}

let writeTextMock: ReturnType<typeof vi.fn>;

function setClipboard(impl?: () => Promise<void>) {
	writeTextMock = vi.fn(impl ?? (() => Promise.resolve()));
	Object.defineProperty(globalThis, "navigator", {
		value: { clipboard: { writeText: writeTextMock } },
		configurable: true,
		writable: true,
	});
}

function removeClipboard() {
	Object.defineProperty(globalThis, "navigator", {
		value: {},
		configurable: true,
		writable: true,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => {});
	savedFeeds.set({});
	requestUrlMock.mockResolvedValue({
		status: 200,
		json: { episodes: [{ episodeId: "ep-123", title: "Episode One" }] },
	} as never);
	queryiTunesMock.mockResolvedValue([]);
	setClipboard();
});

afterEach(() => {
	vi.restoreAllMocks();
	savedFeeds.set({});
});

describe("getUniversalPodcastLink", () => {
	test("uses the saved feed's collectionId and skips the iTunes re-query", async () => {
		savedFeeds.set({
			"Example Show": {
				title: "Example Show",
				url: "https://feeds.example.com/rss",
				artworkUrl: "",
				collectionId: "555",
			},
		});

		await getUniversalPodcastLink(api);

		expect(queryiTunesMock).not.toHaveBeenCalled();
		expect(requestUrlMock).toHaveBeenCalledWith({
			url: "https://pod.link/555.json?limit=1000",
		});
		expect(writeTextMock).toHaveBeenCalledWith(
			"https://pod.link/555/episode/ep-123",
		);
		expect(noticeMessages()).toContain(
			"Universal episode link copied to clipboard.",
		);
	});

	test("matches a saved feed by normalized url when the key differs", async () => {
		savedFeeds.set({
			"Different Key": {
				title: "Different Key",
				// Trailing slash + different case must still match the episode feedUrl.
				url: "HTTPS://Feeds.Example.com/RSS/",
				artworkUrl: "",
				collectionId: "777",
			},
		});

		await getUniversalPodcastLink(api);

		expect(queryiTunesMock).not.toHaveBeenCalled();
		expect(writeTextMock).toHaveBeenCalledWith(
			"https://pod.link/777/episode/ep-123",
		);
	});

	test("falls back to a tolerant iTunes match when no saved collectionId exists", async () => {
		queryiTunesMock.mockResolvedValue([
			{
				title: "Unrelated title casing",
				url: "https://feeds.example.com/rss/",
				artworkUrl: "",
				collectionId: "999",
			},
		]);

		await getUniversalPodcastLink(api);

		expect(queryiTunesMock).toHaveBeenCalledWith("Example Show");
		expect(writeTextMock).toHaveBeenCalledWith(
			"https://pod.link/999/episode/ep-123",
		);
	});

	test("shows an actionable notice when the podcast cannot be matched", async () => {
		queryiTunesMock.mockResolvedValue([]);

		await getUniversalPodcastLink(api);

		expect(requestUrlMock).not.toHaveBeenCalled();
		expect(writeTextMock).not.toHaveBeenCalled();
		expect(noticeMessages()).toContain(
			'Could not find "Example Show" on Apple Podcasts to build a universal link.',
		);
	});

	test("does not announce success when the clipboard write rejects", async () => {
		savedFeeds.set({
			"Example Show": {
				title: "Example Show",
				url: "https://feeds.example.com/rss",
				artworkUrl: "",
				collectionId: "555",
			},
		});
		setClipboard(() => Promise.reject(new Error("denied")));

		await getUniversalPodcastLink(api);

		expect(noticeMessages()).not.toContain(
			"Universal episode link copied to clipboard.",
		);
		expect(noticeMessages()).toContain(
			"Could not copy to clipboard. Episode link: https://pod.link/555/episode/ep-123",
		);
	});

	test("surfaces the link when the clipboard API is unavailable", async () => {
		savedFeeds.set({
			"Example Show": {
				title: "Example Show",
				url: "https://feeds.example.com/rss",
				artworkUrl: "",
				collectionId: "555",
			},
		});
		removeClipboard();

		await getUniversalPodcastLink(api);

		expect(noticeMessages()).toContain(
			"Clipboard unavailable. Episode link: https://pod.link/555/episode/ep-123",
		);
	});
});
