import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import podNotesURIHandler from "./URIHandler";
import type { ParsedFeedEpisodes } from "./parser/feedDocumentParser";
import { FeedRepository } from "./services/FeedRepository";
import { FeedUrlRepository } from "./services/FeedUrlRepository";
import { resolveFeedUrl } from "./services/privateFeeds";
import { DEFAULT_SETTINGS } from "./constants";
import { PlayerController } from "./player/PlayerController";
import { plugin, savedFeeds, viewState } from "./store";
import type { Episode } from "./types/Episode";
import type { PodcastFeed } from "./types/PodcastFeed";
import { ViewState } from "./types/ViewState";
import { privateFeedPlaceholder } from "./utility/privateFeedUrl";
import { deferred, feedDocument, MemoryStorage, stubLegacyStorage } from "../tests/mocks/feeds";
import { FakeDocument } from "../tests/mocks/fakeMedia";

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

let player: PlayerController;
const playing = () => get(player.state).episode;

function resetStores() {
	player = new PlayerController(new FakeDocument().asPlayerDocument(), {
		settings: structuredClone(DEFAULT_SETTINGS),
		app: { vault: {} as never },
		checkpoint: (update) => update(),
		saveSettings: () => Promise.resolve(),
	});
	viewState.set(ViewState.PodcastGrid);
	savedFeeds.set({});
}

beforeEach(resetStores);

afterEach(() => {
	resetStores();
	plugin.set(undefined as never);
});

describe("podNotesURIHandler with saved feeds", () => {
	const SECRET_URL = "https://patron.example.com/PATH_SENTINEL/feed.xml?auth=QUERY_SENTINEL";
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
	function follow(secretStored = true, secretUrl = SECRET_URL) {
		stubLegacyStorage();
		const feedUrls = new FeedUrlRepository(new obsidian.SecretStorage());
		const patron: PodcastFeed = {
			title: "Patron Show",
			url: privateFeedPlaceholder("Patron Show"),
			urlSecretId: secretStored ? feedUrls.store(secretUrl) : "podnotes-feed-url-gone",
			artworkUrl: "",
		};
		const feeds = new FeedRepository({
			load,
			resolveUrl: (feed) => resolveFeedUrl(feed, feedUrls),
			storage: new MemoryStorage(),
			cache: () => ({ enabled: false, ttlHours: 6 }),
			now: Date.now,
		});
		const subscriptions = { [patron.title]: patron, [testEpisode.podcastName]: publicFeed };
		savedFeeds.set(subscriptions);
		feeds.setSubscriptions(subscriptions);
		plugin.set({
			app: { vault: { getAbstractFileByPath: () => null } },
			feeds,
			feedUrls,
			player,
		} as never);
		return { feeds, feedUrls, patron };
	}
	const publicFeed: PodcastFeed = { title: "Test Podcast", url: testFeedUrl, artworkUrl: "" };
	const open = (url: string, episodeName: string) =>
		podNotesURIHandler({ action: "podnotes", url, episodeName, time: "5" });
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
		expect(playing()).toMatchObject({
			title: second.title,
			podcastName: "Patron Show",
		});
		expect(get(viewState)).toBe(ViewState.Player);
	});

	test("a private feed link plays the episode with its guid after the publisher retitled it", async () => {
		follow();
		const retitled = { ...first, title: "Bonus: behind the scenes", guid: "patron-1" };
		load.mockResolvedValue(feedDocument("Patron Show", [second, retitled]));

		await podNotesURIHandler({
			action: "podnotes",
			url: privateLink,
			episodeName: first.title,
			guid: "patron-1",
			time: "5",
		});

		expect(playing()).toMatchObject({ title: retitled.title, guid: "patron-1" });
	});

	test("a link to a private feed by its secret URL plays the subscription's episode, which keeps the secret out", async () => {
		follow();
		const linkless = { ...second, url: "" };
		load.mockResolvedValue(feedDocument("Patron Show", [first, linkless]));

		await open(SECRET_URL, linkless.title);

		expect(playing()).toMatchObject({
			title: linkless.title,
			podcastName: "Patron Show",
			url: privateLink,
			feedUrl: privateLink,
		});
		expect(JSON.stringify(playing())).not.toMatch(/PATH_SENTINEL|QUERY_SENTINEL/);
	});

	test("a link to the playing private episode by its secret URL seeks it without loading the feed", async () => {
		const { feeds } = follow();
		load.mockResolvedValue(feedDocument("Patron Show", [first]));
		await feeds.ensureAll();
		const [subscribed] = get(feeds).get("Patron Show")?.episodes ?? [];
		player.play(subscribed);
		load.mockClear();

		await open(SECRET_URL, first.title);

		expect(load).not.toHaveBeenCalled();
		expect(get(player.state).currentTime).toBe(5);
		expect(playing()).toMatchObject({ title: first.title, feedUrl: privateLink });
	});

	test("a link to a private feed by its secret URL takes the secret out of the episode loaded from it before subscribing", async () => {
		player.play({ ...first, url: SECRET_URL, feedUrl: SECRET_URL });
		follow();
		load.mockResolvedValue(feedDocument("Patron Show", [{ ...first, url: "" }]));

		await open(SECRET_URL, first.title);

		expect(playing()).toMatchObject({
			title: first.title,
			url: privateLink,
			feedUrl: privateLink,
		});
		expect(JSON.stringify(playing())).not.toMatch(/PATH_SENTINEL|QUERY_SENTINEL/);
		expect(get(player.state).currentTime).toBe(5);
	});

	const HTTP_SECRET_URL = SECRET_URL.replace("https:", "http:");

	test.each([
		[
			"an uppercase host",
			SECRET_URL,
			SECRET_URL.replace("patron.example.com", "PATRON.EXAMPLE.COM"),
		],
		["an uppercase scheme", SECRET_URL, SECRET_URL.replace("https:", "HTTPS:")],
		["https's default port", SECRET_URL, SECRET_URL.replace(".com/", ".com:443/")],
		["http's default port", HTTP_SECRET_URL, HTTP_SECRET_URL.replace(".com/", ".com:80/")],
	])(
		"a link to a private feed by its secret URL with %s plays the subscription's episode",
		async (_, secretUrl, link) => {
			follow(true, secretUrl);
			player.play(testEpisode);
			const linkless = { ...first, url: "" };
			load.mockResolvedValue(feedDocument("Patron Show", [linkless]));

			await open(link, linkless.title);

			expect(playing()).toMatchObject({
				title: linkless.title,
				podcastName: "Patron Show",
				url: privateLink,
				feedUrl: privateLink,
			});
			expect(JSON.stringify(playing())).not.toMatch(/PATH_SENTINEL|QUERY_SENTINEL/);
			expect(load.mock.calls).toEqual([[secretUrl]]);
		},
	);

	test.each([
		["another path case", SECRET_URL.replace("feed.xml", "FEED.xml")],
		["a trailing slash", SECRET_URL.replace("feed.xml", "feed.xml/")],
		["another query", SECRET_URL.replace("QUERY_SENTINEL", "OTHER_SENTINEL")],
		["http for https", HTTP_SECRET_URL],
	])("a link with %s is not the private feed's secret URL", async (_, link) => {
		follow();
		player.play(testEpisode);
		load.mockResolvedValue(feedDocument("Patron Show", [{ ...first, url: "" }]));

		await open(link, first.title);

		expect(load.mock.calls).toEqual([[link]]);
		expect(playing()).toMatchObject({ title: first.title, feedUrl: link });
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
		expect(playing()).toBeUndefined();
	});

	test("a private feed link that cannot load says so once", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		follow();
		load.mockRejectedValue(new Error("offline"));

		await open(privateLink, first.title);

		expect(notice.mock.calls).toEqual([["Could not load the podcast feed"]]);
		expect(playing()).toBeUndefined();
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
		expect(playing()).toMatchObject({ title: first.title });
	});

	test("a private feed link to an episode the last copy lacks says the feed is not available", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		await lostPrivateUrl();

		await open(privateLink, second.title);

		expect(notice.mock.calls).toEqual([[PRIVATE_LINK_NOTICE]]);
		expect(playing()).toBeUndefined();
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
		expect(playing()).toBeUndefined();
	});

	test("a link to a saved private feed whose URL is not on this device leaves an earlier link to play", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		follow(false);
		const earlier = deferred<ParsedFeedEpisodes>();
		load.mockReturnValueOnce(earlier.promise);

		const opening = open(testFeedUrl, testEpisode.title);
		await open(privateLink, first.title);
		earlier.resolve(feedDocument("Test Podcast", [testEpisode]));
		await opening;

		expect(notice.mock.calls).toEqual([[PRIVATE_LINK_NOTICE]]);
		expect(playing()).toMatchObject({ title: testEpisode.title, podcastName: "Test Podcast" });
	});

	test("a play the user starts while a private feed link loads wins", async () => {
		follow();
		const fetching = deferred<ParsedFeedEpisodes>();
		load.mockReturnValueOnce(fetching.promise);

		const opening = open(privateLink, first.title);
		player.play(testEpisode);
		fetching.resolve(feedDocument("Patron Show", [first]));
		await opening;

		expect(playing()).toMatchObject({ title: testEpisode.title, podcastName: "Test Podcast" });
	});

	test("a link that plays from a private feed's last copy wins over an earlier link", async () => {
		await lostPrivateUrl();
		const earlier = deferred<ParsedFeedEpisodes>();
		load.mockReturnValueOnce(earlier.promise);

		const opening = open(testFeedUrl, testEpisode.title);
		await open(privateLink, first.title);
		earlier.resolve(feedDocument("Test Podcast", [testEpisode]));
		await opening;

		expect(playing()).toMatchObject({ title: first.title, podcastName: "Patron Show" });
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

		expect(playing()).toMatchObject({ title: testEpisode.title });
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

			expect(playing()).toMatchObject({ title: second.title });
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
			expect(playing()).toMatchObject({ title: first.title });
		},
	);
});
