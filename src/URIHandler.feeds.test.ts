import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import podNotesURIHandler from "./URIHandler";
import type { ParsedFeedEpisodes } from "./parser/feedDocumentParser";
import { FeedRepository } from "./services/FeedRepository";
import { FeedUrlRepository } from "./services/FeedUrlRepository";
import { resolveFeedUrl } from "./services/privateFeeds";
import {
	activePlaybackSegment,
	currentEpisode,
	plugin,
	requestedPlaybackTime,
	viewState,
} from "./store";
import type { Episode } from "./types/Episode";
import type { PodcastFeed } from "./types/PodcastFeed";
import { ViewState } from "./types/ViewState";
import { privateFeedPlaceholder } from "./utility/privateFeedUrl";
import { deferred, feedDocument, MemoryStorage, stubLegacyStorage } from "../tests/mocks/feeds";

const testFeedUrl = "https://pod.example.com/feed.xml";

const testEpisode: Episode = {
	title: "Finished Episode",
	streamUrl: "https://pod.example.com/audio.mp3",
	url: "https://pod.example.com/episode",
	description: "",
	content: "",
	podcastName: "Test Podcast",
	feedUrl: testFeedUrl,
};

const api = {};

function resetStores() {
	currentEpisode.update(() => undefined as unknown as Episode);
	activePlaybackSegment.set(null);
	requestedPlaybackTime.set(null);
	viewState.set(ViewState.PodcastGrid);
}

beforeEach(resetStores);

afterEach(() => {
	resetStores();
	plugin.set(undefined as never);
});

describe("podNotesURIHandler with saved feeds", () => {
	const SECRET_URL = "https://patron.example.com/feed.xml?auth=s3cret";
	const PRIVATE_LINK_NOTICE =
		"This link points to a private feed that is not available on this device.";
	const patronEpisode = (title: string): Episode => ({
		...testEpisode,
		title,
		streamUrl: `https://patron.example.com/${encodeURIComponent(title)}.mp3`,
		podcastName: "Patron Show",
	});
	const first = patronEpisode("First Episode");
	const second = patronEpisode("Second Episode");
	const load = vi.fn<(url: string) => Promise<ParsedFeedEpisodes>>();

	/** Subscribes to "Patron Show", whose URL is on this device only when `secretStored`. */
	function follow(secretStored = true) {
		stubLegacyStorage();
		const feedUrls = new FeedUrlRepository(new obsidian.SecretStorage());
		const patron: PodcastFeed = {
			title: "Patron Show",
			url: privateFeedPlaceholder("Patron Show"),
			urlSecretId: secretStored ? feedUrls.store(SECRET_URL) : "podnotes-feed-url-gone",
			artworkUrl: "",
		};
		const feeds = new FeedRepository({
			load,
			resolveUrl: (feed) => resolveFeedUrl(feed, feedUrls),
			storage: new MemoryStorage(),
			cache: () => ({ enabled: false, ttlHours: 6 }),
			now: Date.now,
		});
		feeds.setSubscriptions({ [patron.title]: patron, [testEpisode.podcastName]: publicFeed });
		plugin.set({
			app: { vault: { getAbstractFileByPath: () => null } },
			feeds,
		} as never);
		return { feeds, feedUrls, patron };
	}
	const publicFeed: PodcastFeed = { title: "Test Podcast", url: testFeedUrl, artworkUrl: "" };
	const open = (url: string, episodeName: string) =>
		podNotesURIHandler({ action: "podnotes", url, episodeName, time: "5" }, api as never);
	const privateLink = privateFeedPlaceholder("Patron Show");

	afterEach(() => {
		load.mockReset();
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	});

	test("a private feed link loads the saved feed and plays the linked episode", async () => {
		follow();
		load.mockResolvedValue(feedDocument("Patron Show", [first, second]));

		await open(privateLink, second.title);

		expect(load).toHaveBeenCalledWith(SECRET_URL);
		expect(get(currentEpisode)).toMatchObject({
			title: second.title,
			podcastName: "Patron Show",
		});
		expect(get(viewState)).toBe(ViewState.Player);
	});

	test.each([
		["a podcast this device does not follow", privateFeedPlaceholder("Other Show"), true],
		["a private feed whose URL is not on this device", privateLink, false],
	])("a link to %s shows one notice", async (_, url, secretStored) => {
		const notice = vi.spyOn(obsidian, "Notice");
		follow(secretStored);

		await open(url, first.title);

		expect(notice.mock.calls).toEqual([[PRIVATE_LINK_NOTICE]]);
		expect(load).not.toHaveBeenCalled();
		expect(get(currentEpisode)).toBeUndefined();
	});

	test("a private feed link that cannot load says so once", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		follow();
		load.mockRejectedValue(new Error("offline"));

		await open(privateLink, first.title);

		expect(notice.mock.calls).toEqual([["Could not load the podcast feed"]]);
		expect(get(currentEpisode)).toBeUndefined();
	});

	/** "Patron Show" loaded once with `first`, then its URL left this device. */
	async function lostPrivateUrl() {
		const { feeds, feedUrls, patron } = follow();
		load.mockResolvedValue(feedDocument("Patron Show", [first]));
		await feeds.ensureAll();
		feedUrls.delete(patron.urlSecretId ?? "");
		load.mockClear();
	}

	test("a private feed link plays from the last copy of the feed when its URL left this device", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		await lostPrivateUrl();

		await open(privateLink, first.title);

		expect(load).not.toHaveBeenCalled();
		expect(notice).not.toHaveBeenCalled();
		expect(get(currentEpisode)).toMatchObject({ title: first.title });
	});

	test("a private feed link to an episode the last copy lacks says the feed is not available", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		await lostPrivateUrl();

		await open(privateLink, second.title);

		expect(notice.mock.calls).toEqual([[PRIVATE_LINK_NOTICE]]);
		expect(get(currentEpisode)).toBeUndefined();
	});

	test("a private feed link to an episode the last copy lacks says the feed could not load when offline", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const { feeds } = follow();
		load.mockResolvedValue(feedDocument("Patron Show", [first]));
		await feeds.ensureAll();
		load.mockRejectedValue(new Error("offline"));

		await open(privateLink, second.title);

		expect(notice.mock.calls).toEqual([["Could not load the podcast feed"]]);
		expect(get(currentEpisode)).toBeUndefined();
	});

	test("a private feed link that loads after a newer link changes nothing", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		follow();
		const older = deferred<ParsedFeedEpisodes>();
		load.mockImplementation((url) =>
			url === SECRET_URL
				? older.promise
				: Promise.resolve(feedDocument("Test Podcast", [testEpisode])),
		);

		const opening = open(privateLink, first.title);
		await open(testFeedUrl, testEpisode.title);
		older.resolve(feedDocument("Patron Show", [first]));
		await opening;

		expect(get(currentEpisode)).toMatchObject({ title: testEpisode.title });
		expect(notice).not.toHaveBeenCalled();
	});

	test.each([
		["a public", testFeedUrl, "Test Podcast"],
		["a private", privateFeedPlaceholder("Patron Show"), "Patron Show"],
	])(
		"%s feed link finds an episode published since the feed last loaded",
		async (_, url, title) => {
			const { feeds } = follow();
			load.mockResolvedValue(feedDocument(title, [first]));
			await feeds.ensureAll();
			load.mockResolvedValue(feedDocument(title, [second, first]));

			await open(url, second.title);

			expect(get(currentEpisode)).toMatchObject({ title: second.title });
		},
	);

	test.each([
		["a public", testFeedUrl, "Test Podcast"],
		["a private", privateFeedPlaceholder("Patron Show"), "Patron Show"],
	])(
		"%s feed link plays from the last copy of the feed when it cannot be reached",
		async (_, url, title) => {
			vi.spyOn(console, "error").mockImplementation(() => {});
			const { feeds } = follow();
			load.mockResolvedValue(feedDocument(title, [first]));
			await feeds.ensureAll();
			load.mockRejectedValue(new Error("offline"));

			await open(url, first.title);

			expect(load).toHaveBeenCalledTimes(3);
			expect(get(currentEpisode)).toMatchObject({ title: first.title });
		},
	);
});
