import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { ParsedEpisodeDocument, ParsedFeedEpisodes } from "src/parser/feedDocumentParser";
import { encodeEpisode } from "src/persistence/episodeCodec";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { deferred, MemoryStorage, stubLegacyStorage } from "../../tests/mocks/feeds";
import { FeedRepository } from "./FeedRepository";

const CACHE_KEY = "podnotes:feed-cache:v6";
const HOUR = 3_600_000;

const alpha: PodcastFeed = {
	title: "Alpha",
	url: "https://alpha.test/feed.xml",
	artworkUrl: "https://alpha.test/art.jpg",
};
const beta: PodcastFeed = { title: "Beta", url: "https://beta.test/feed.xml", artworkUrl: "" };

function item(number: number, fields: Partial<ParsedEpisodeDocument> = {}): ParsedEpisodeDocument {
	return {
		title: `Episode ${number}`,
		streamUrl: `https://media.test/${number}.mp3`,
		description: `Notes ${number}`,
		content: "",
		episodeDate: new Date(Date.UTC(2024, 0, 1) + number * HOUR),
		mediaType: "audio",
		...fields,
	};
}

function doc(title: string, items: ParsedEpisodeDocument[]): ParsedFeedEpisodes {
	return { feed: { title }, episodes: items };
}

function setup(
	options: {
		storage?: MemoryStorage;
		enabled?: boolean;
		resolveUrl?: (feed: PodcastFeed) => string | null;
	} = {},
) {
	let clock = Date.UTC(2026, 9, 11);
	const requests: { url: string; respond: ReturnType<typeof deferred<ParsedFeedEpisodes>> }[] =
		[];
	const load = vi.fn((url: string) => {
		const respond = deferred<ParsedFeedEpisodes>();
		requests.push({ url, respond });
		return respond.promise;
	});
	const storage = options.storage ?? new MemoryStorage();
	const repo = new FeedRepository({
		load,
		resolveUrl: options.resolveUrl ?? ((feed) => feed.url),
		storage,
		cache: () => ({ enabled: options.enabled ?? true, ttlHours: 6 }),
		now: () => clock,
	});
	return {
		repo,
		load,
		requests,
		storage,
		advance: (ms: number) => (clock += ms),
		feed: (key: string) => get(repo).get(key),
		titles: (key: string) =>
			get(repo)
				.get(key)
				?.episodes.map((episode) => episode.title),
		cached: () => JSON.parse((storage.loadLocalStorage(CACHE_KEY) as string | null) ?? "{}"),
	};
}

async function loaded(
	t: ReturnType<typeof setup>,
	feeds: Record<string, PodcastFeed>,
	response: ParsedFeedEpisodes,
) {
	t.repo.setSubscriptions(feeds);
	const loading = t.repo.ensureAll();
	for (const request of t.requests) request.respond.resolve(response);
	await loading;
}

let legacyStorage = new Map<string, string>();

beforeEach(() => {
	legacyStorage = stubLegacyStorage();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("FeedRepository", () => {
	test("two subscriptions sharing a URL fetch once and each names the episodes after itself", async () => {
		const t = setup();
		t.repo.setSubscriptions({
			Alpha: alpha,
			"Alpha Alias": { ...alpha, title: "Alpha Alias" },
		});

		const loading = t.repo.ensureAll();
		expect(t.load).toHaveBeenCalledTimes(1);
		t.requests[0].respond.resolve(doc("Alpha Channel", [item(1)]));
		await loading;

		expect(t.feed("Alpha")?.episodes[0]).toMatchObject({
			podcastName: "Alpha",
			feedUrl: alpha.url,
		});
		expect(t.feed("Alpha Alias")?.episodes[0]).toMatchObject({
			podcastName: "Alpha Alias",
			feedUrl: alpha.url,
		});
	});

	test("a refresh while the feed is loading joins that request", async () => {
		const t = setup();
		t.repo.setSubscriptions({ Alpha: alpha });

		const first = t.repo.ensureAll();
		const refresh = t.repo.load(["Alpha"], "network");
		t.requests[0].respond.resolve(doc("Alpha", [item(1)]));
		await expect(Promise.all([first, refresh])).resolves.toEqual([true, true]);

		expect(t.load).toHaveBeenCalledTimes(1);
		expect(t.titles("Alpha")).toEqual(["Episode 1"]);
	});

	test("refreshes keep the shown episodes until they answer, in whatever order they answer", async () => {
		const t = setup();
		t.repo.setSubscriptions({ Alpha: alpha, Beta: beta });
		const first = t.repo.ensureAll();
		t.requests[0].respond.resolve(doc("Alpha", [item(1)]));
		t.requests[1].respond.resolve(doc("Beta", [item(2)]));
		await first;

		const refresh = t.repo.load(["Alpha", "Beta"], "network");
		expect(t.feed("Alpha")).toMatchObject({ status: "loading" });
		expect(t.titles("Alpha")).toEqual(["Episode 1"]);
		t.requests[3].respond.resolve(doc("Beta", [item(4)]));
		t.requests[2].respond.resolve(doc("Alpha", [item(3)]));
		await refresh;

		expect(t.titles("Alpha")).toEqual(["Episode 3"]);
		expect(t.titles("Beta")).toEqual(["Episode 4"]);
		expect(t.feed("Alpha")?.status).toBe("ready");
	});

	test("an expired document is served as stale and survives a failed refresh", async () => {
		const t = setup();
		await loaded(t, { Alpha: alpha }, doc("Alpha", [item(1)]));
		t.advance(7 * HOUR);

		const refresh = t.repo.ensureAll();
		expect(t.load).toHaveBeenCalledTimes(2);
		expect(t.titles("Alpha")).toEqual(["Episode 1"]);
		t.requests[1].respond.reject(new Error("offline"));
		await refresh;

		expect(t.feed("Alpha")).toMatchObject({ status: "stale", error: "network" });
		expect(t.titles("Alpha")).toEqual(["Episode 1"]);
		expect(Object.keys(t.cached())).toEqual([alpha.url]);
	});

	test("a feed that never loaded reports the failure", async () => {
		const t = setup();
		t.repo.setSubscriptions({ Alpha: alpha });
		const loading = t.repo.ensureAll();
		t.requests[0].respond.reject(new Error("offline"));
		await expect(loading).resolves.toBe(false);

		expect(t.feed("Alpha")).toMatchObject({ status: "error", error: "network", episodes: [] });
	});

	test("a response for a podcast removed while it loads is dropped and not cached", async () => {
		const t = setup();
		t.repo.setSubscriptions({ Alpha: alpha, Beta: beta });
		const loading = t.repo.ensureAll();
		t.requests[0].respond.resolve(doc("Alpha", [item(1)]));

		t.repo.setSubscriptions({ Alpha: alpha });
		t.requests[1].respond.resolve(doc("Beta", [item(2)]));
		await loading;

		expect([...get(t.repo).keys()]).toEqual(["Alpha"]);
		expect(Object.keys(t.cached())).toEqual([alpha.url]);

		t.repo.setSubscriptions({ Alpha: alpha, Beta: beta });
		expect(t.titles("Beta")).toEqual([]);
		void t.repo.ensureAll();
		expect(t.load).toHaveBeenCalledTimes(3);
	});

	test("a late response for a podcast's old URL never replaces its new feed", async () => {
		const t = setup();
		const moved = { ...alpha, url: "https://alpha.test/moved.xml" };
		t.repo.setSubscriptions({ Alpha: alpha });
		const before = t.repo.ensureAll();

		t.repo.setSubscriptions({ Alpha: moved });
		const after = t.repo.ensureAll();
		t.requests[1].respond.resolve(doc("Alpha", [item(2)]));
		t.requests[0].respond.resolve(doc("Alpha", [item(1)]));
		await Promise.all([before, after]);

		expect(t.requests.map((request) => request.url)).toEqual([alpha.url, moved.url]);
		expect(t.titles("Alpha")).toEqual(["Episode 2"]);
		expect(Object.keys(t.cached())).toEqual([moved.url]);
	});

	test("Clear cache drops every document but still applies a refresh in flight", async () => {
		const t = setup();
		await loaded(t, { Alpha: alpha }, doc("Alpha", [item(1)]));
		const refresh = t.repo.load(["Alpha"], "network");

		t.repo.clear();
		expect(t.storage.loadLocalStorage(CACHE_KEY)).toBeNull();
		expect(t.feed("Alpha")).toMatchObject({ status: "loading", episodes: [] });
		t.requests[1].respond.resolve(doc("Alpha", [item(2)]));
		await refresh;

		expect(t.load).toHaveBeenCalledTimes(2);
		expect(t.titles("Alpha")).toEqual(["Episode 2"]);
		expect(Object.keys(t.cached())).toEqual([alpha.url]);
	});

	test("a cached slice of a long feed loads in full when opened, and only once", async () => {
		const first = setup();
		const items = Array.from({ length: 76 }, (_, index) => item(76 - index));
		await loaded(first, { Alpha: alpha }, doc("Alpha", items));
		expect(first.cached()[alpha.url]).toMatchObject({ complete: false });
		expect(first.cached()[alpha.url].items).toHaveLength(75);

		const t = setup({ storage: first.storage });
		t.repo.setSubscriptions({ Alpha: alpha });
		await t.repo.ensureAll();
		expect(t.load).not.toHaveBeenCalled();
		expect(t.titles("Alpha")).toHaveLength(75);

		const opening = t.repo.load(["Alpha"], "complete");
		t.requests[0].respond.resolve(doc("Alpha", items));
		await opening;
		await t.repo.load(["Alpha"], "complete");

		expect(t.load).toHaveBeenCalledTimes(1);
		expect(t.titles("Alpha")).toHaveLength(76);
	});

	test("a cached feed of exactly 75 episodes is complete", async () => {
		const first = setup();
		const items = Array.from({ length: 75 }, (_, index) => item(index));
		await loaded(first, { Alpha: alpha }, doc("Alpha", items));

		const t = setup({ storage: first.storage });
		t.repo.setSubscriptions({ Alpha: alpha });
		await t.repo.load(["Alpha"], "complete");

		expect(t.load).not.toHaveBeenCalled();
		expect(t.titles("Alpha")).toHaveLength(75);
	});

	test("the cache keeps the newest 75 episodes by date, in feed order", async () => {
		const t = setup();
		const oldestFirst = [
			item(0, { episodeDate: undefined }),
			...Array.from({ length: 100 }, (_, index) => item(index + 1)),
		];
		await loaded(t, { Alpha: alpha }, doc("Alpha", oldestFirst));

		const titles = t.cached()[alpha.url].items.map((cached: { title: string }) => cached.title);
		expect(titles).toEqual(Array.from({ length: 75 }, (_, index) => `Episode ${index + 26}`));
	});

	test("a reloaded cache gives back the same episodes", async () => {
		const first = setup();
		const episode = item(1, {
			episodeNumber: 42,
			duration: 3723,
			mediaType: "video",
			chaptersUrl: "https://media.test/1.json",
			itemLink: "https://alpha.test/1",
		});
		await loaded(first, { Alpha: alpha }, doc("Alpha", [episode]));

		const t = setup({ storage: first.storage });
		t.repo.setSubscriptions({ Alpha: alpha });
		await t.repo.ensureAll();

		expect(t.feed("Alpha")?.episodes).toEqual(first.feed("Alpha")?.episodes);
		expect(t.feed("Alpha")?.episodes[0].episodeDate).toEqual(episode.episodeDate);
	});

	test("writes only subscribed podcasts to the cache", async () => {
		const t = setup();
		await loaded(t, { Alpha: alpha, Beta: beta }, doc("Show", [item(1)]));
		expect(Object.keys(t.cached()).sort()).toEqual([alpha.url, beta.url]);

		t.repo.setSubscriptions({ Alpha: alpha });

		expect(Object.keys(t.cached())).toEqual([alpha.url]);
	});

	test("a podcast removed while PodNotes was closed leaves the cache when it is read", async () => {
		const first = setup();
		await loaded(first, { Alpha: alpha, Beta: beta }, doc("Show", [item(1)]));

		const t = setup({ storage: first.storage });
		t.repo.setSubscriptions({ Alpha: alpha });
		await t.repo.ensureAll();

		expect(t.load).not.toHaveBeenCalled();
		expect(Object.keys(t.cached())).toEqual([alpha.url]);
	});

	test("a feed previewed and then added is cached without fetching it again", async () => {
		const t = setup();
		t.repo.setSubscriptions({ Alpha: alpha });
		const preview = t.repo.channelAt({ url: beta.url });
		t.requests[0].respond.resolve(doc("Beta", [item(1)]));
		await preview;

		t.repo.setSubscriptions({ Alpha: alpha, Beta: beta });

		expect(t.load).toHaveBeenCalledTimes(1);
		expect(Object.keys(t.cached())).toEqual([beta.url]);
	});

	test("changing podcasts before the cache is read keeps the cache", async () => {
		const first = setup();
		await loaded(first, { Alpha: alpha }, doc("Alpha", [item(1)]));

		const t = setup({ storage: first.storage });
		t.repo.setSubscriptions({ Alpha: alpha });
		t.repo.setSubscriptions({ Alpha: alpha, Beta: beta });

		expect(Object.keys(t.cached())).toEqual([alpha.url]);
	});

	test("previews and links of other feeds do not rewrite the cache", async () => {
		const t = setup();
		await loaded(t, { Alpha: alpha }, doc("Alpha", [item(1)]));
		const save = vi.spyOn(t.storage, "saveLocalStorage");

		const preview = t.repo.channelAt({ url: beta.url });
		t.requests[1].respond.resolve(doc("Beta", [item(2)]));
		await preview;

		expect(save).not.toHaveBeenCalled();
	});

	test("a cache that cannot be saved is dropped and the feed still loads", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const t = setup();
		await loaded(t, { Alpha: alpha }, doc("Alpha", [item(1)]));
		const save = vi.spyOn(t.storage, "saveLocalStorage").mockImplementation((key, value) => {
			if (value !== null) throw new DOMException("full", "QuotaExceededError");
			t.storage.values.delete(key);
		});

		const quota = t.repo.load(["Alpha"], "network");
		t.requests[1].respond.resolve(doc("Alpha", [item(2)]));
		await quota;
		expect(t.storage.loadLocalStorage(CACHE_KEY)).toBeNull();
		expect(t.feed("Alpha")).toMatchObject({ status: "ready" });

		save.mockImplementation(() => {
			throw new Error("storage unavailable");
		});
		const broken = t.repo.load(["Alpha"], "network");
		t.requests[2].respond.resolve(doc("Alpha", [item(3)]));
		await broken;

		expect(t.feed("Alpha")).toMatchObject({ status: "ready" });
		expect(t.titles("Alpha")).toEqual(["Episode 3"]);
	});

	test("a cache over 4 MB keeps the most recently fetched feeds", async () => {
		const t = setup();
		const feeds = [1, 2, 3].map((number) => ({
			title: `Show ${number}`,
			url: `https://show${number}.test/feed.xml`,
			artworkUrl: "",
		}));
		t.repo.setSubscriptions(Object.fromEntries(feeds.map((feed) => [feed.title, feed])));
		for (const feed of feeds) {
			const loading = t.repo.load([feed.title], "cached");
			t.requests
				.at(-1)
				?.respond.resolve(doc(feed.title, [item(1, { content: "x".repeat(1_500_000) })]));
			await loading;
			t.advance(1000);
		}

		expect(Object.keys(t.cached()).sort()).toEqual([feeds[1].url, feeds[2].url]);
	});

	test("with the cache off nothing is read or written, and documents still expire", async () => {
		const seeded = setup();
		await loaded(seeded, { Alpha: alpha }, doc("Alpha", [item(1)]));
		const stored = seeded.storage.loadLocalStorage(CACHE_KEY);

		const t = setup({ storage: seeded.storage, enabled: false });
		await loaded(t, { Alpha: alpha }, doc("Alpha", [item(2)]));
		expect(t.titles("Alpha")).toEqual(["Episode 2"]);
		expect(t.storage.loadLocalStorage(CACHE_KEY)).toBe(stored);

		await t.repo.ensureAll();
		expect(t.load).toHaveBeenCalledTimes(1);
		t.advance(7 * HOUR);
		void t.repo.ensureAll();
		expect(t.load).toHaveBeenCalledTimes(2);
	});

	test("a private feed whose URL is not on this device is never fetched", async () => {
		const resolveUrl = vi.fn(() => null);
		const t = setup({ resolveUrl });
		const placeholder = privateFeedPlaceholder("Private");
		t.repo.setSubscriptions({ Private: { ...alpha, url: placeholder, urlSecretId: "id" } });

		await t.repo.ensureAll();

		expect(t.load).not.toHaveBeenCalled();
		expect(t.feed("Private")).toMatchObject({ status: "error", error: "unavailable" });
	});

	test("a fresh cached private feed does not ask for its URL", async () => {
		const privateFeed = { ...alpha, url: privateFeedPlaceholder("Private"), urlSecretId: "id" };
		const seeded = setup({ resolveUrl: () => "https://private.test/feed.xml?auth=s3cret" });
		await loaded(seeded, { Private: privateFeed }, doc("Private", [item(1)]));

		const resolveUrl = vi.fn(() => null);
		const t = setup({ storage: seeded.storage, resolveUrl });
		t.repo.setSubscriptions({ Private: privateFeed });
		await t.repo.ensureAll();

		expect(resolveUrl).not.toHaveBeenCalled();
		expect(t.titles("Private")).toEqual(["Episode 1"]);
	});

	test("a private feed's URL reaches neither the cache nor its episodes", async () => {
		const secretUrl = "https://private.test/feed.xml?auth=s3cret";
		const placeholder = privateFeedPlaceholder("Private");
		const t = setup({ resolveUrl: () => secretUrl });
		await loaded(
			t,
			{ Private: { ...alpha, url: placeholder, urlSecretId: "id" } },
			doc("Private", [item(1)]),
		);

		expect(t.load).toHaveBeenCalledWith(secretUrl);
		expect(t.storage.loadLocalStorage(CACHE_KEY)).not.toContain("s3cret");
		expect(t.feed("Private")?.episodes[0]).toMatchObject({
			url: placeholder,
			feedUrl: placeholder,
		});
	});

	test("episodes saved to data.json carry no feed-only metadata", async () => {
		const t = setup();
		const transcripts = [{ url: "https://media.test/1.vtt", type: "text/vtt" }];
		await loaded(t, { Alpha: alpha }, doc("Alpha", [item(1, { guid: "guid-1", transcripts })]));

		const persisted = encodeEpisode(t.feed("Alpha")!.episodes[0]);

		expect(persisted).toMatchObject({ title: "Episode 1", podcastName: "Alpha" });
		expect(persisted).not.toHaveProperty("guid");
		expect(persisted).not.toHaveProperty("transcripts");
	});

	test("reads an episode's guid and transcripts from its own subscription's feed", async () => {
		const t = setup();
		const transcripts = [{ url: "https://media.test/b.vtt", type: "text/vtt" }];
		const items = [
			item(1, { title: "Rerun", guid: "guid-a" }),
			item(2, { title: "Rerun", guid: "guid-b", transcripts }),
		];
		await loaded(
			t,
			{ Alpha: alpha, "Alpha Alias": { ...alpha, title: "Alpha Alias" } },
			doc("Alpha", items),
		);
		const [first] = t.feed("Alpha")!.episodes;
		const [, second] = t.feed("Alpha Alias")!.episodes;

		expect(t.repo.episodeMetadata("Alpha", first)).toEqual({ guid: "guid-a", transcripts: [] });
		expect(t.repo.episodeMetadata("Alpha Alias", second)).toEqual({
			guid: "guid-b",
			transcripts,
		});
		expect(t.repo.episodeMetadata("Beta", first)).toBeUndefined();
		expect(
			t.repo.episodeMetadata("Alpha", { ...first, streamUrl: "https://media.test/gone.mp3" }),
		).toBeUndefined();
	});

	test("episodes keep their array until the feed's document, title or artwork changes", async () => {
		const t = setup();
		await loaded(t, { Alpha: alpha, Beta: beta }, doc("Show", [item(1)]));
		const episodes = t.feed("Alpha")?.episodes;

		await t.repo.ensureAll();
		expect(t.feed("Alpha")?.episodes).toBe(episodes);

		t.repo.setSubscriptions({ Alpha: { ...alpha, title: "Alpha Renamed" }, Beta: beta });
		expect(t.feed("Alpha")?.episodes[0].podcastName).toBe("Alpha Renamed");
	});

	test("ignores a malformed cache, drops unsafe keys and salvages an invalid date", async () => {
		const storage = new MemoryStorage();
		const valid = {
			updatedAt: Date.UTC(2026, 9, 11),
			complete: true,
			channel: { title: "Alpha" },
		};
		for (const stored of [
			"[]",
			"not json",
			JSON.stringify({ [alpha.url]: { ...valid, updatedAt: "yesterday", items: [] } }),
		]) {
			storage.saveLocalStorage(CACHE_KEY, stored);
			const t = setup({ storage });
			t.repo.setSubscriptions({ Alpha: alpha });
			void t.repo.ensureAll();
			expect(t.load).toHaveBeenCalledTimes(1);
		}

		storage.saveLocalStorage(
			CACHE_KEY,
			`{"__proto__":{"updatedAt":1,"items":[]},"${alpha.url}":${JSON.stringify({
				...valid,
				items: [{ ...item(1), episodeDate: "not-a-date" }, { title: 2 }],
			})}}`,
		);
		const t = setup({ storage });
		t.repo.setSubscriptions({ Alpha: alpha });
		await t.repo.ensureAll();

		expect(t.load).not.toHaveBeenCalled();
		expect(t.feed("Alpha")?.episodes).toEqual([
			expect.objectContaining({ title: "Episode 1", episodeDate: undefined }),
		]);
		expect(({} as { updatedAt?: number }).updatedAt).toBeUndefined();
	});

	test("skips malformed cached transcript links and keeps their episodes", async () => {
		const storage = new MemoryStorage();
		storage.saveLocalStorage(
			CACHE_KEY,
			JSON.stringify({
				[alpha.url]: {
					updatedAt: Date.UTC(2026, 9, 11),
					complete: true,
					channel: { title: "Alpha" },
					items: [
						{
							...item(1),
							transcripts: [
								null,
								"t.vtt",
								{ url: 7, type: "text/vtt" },
								{ url: "t.srt", type: ["application/srt"] },
								{ url: "t.json", type: "application/json", language: 5 },
								{
									url: "t.txt",
									type: "text/plain; charset=utf-8",
									rel: "captions",
								},
							],
						},
						{ ...item(2), transcripts: { url: "t.vtt", type: "text/vtt" } },
					],
				},
			}),
		);
		const t = setup({ storage });
		t.repo.setSubscriptions({ Alpha: alpha });
		await t.repo.ensureAll();
		const [first, second] = t.feed("Alpha")!.episodes;

		expect(t.load).not.toHaveBeenCalled();
		expect(t.repo.episodeMetadata("Alpha", first)?.transcripts).toEqual([
			{ url: "t.txt", type: "text/plain; charset=utf-8", rel: "captions" },
		]);
		expect(t.repo.episodeMetadata("Alpha", second)?.transcripts).toEqual([]);
	});

	test.each([true, false])(
		"removes the caches of earlier versions (cache on: %s)",
		async (enabled) => {
			const storage = new MemoryStorage();
			storage.saveLocalStorage("podnotes:feed-cache:v5", "{}");
			for (const version of [1, 2, 3, 4])
				legacyStorage.set(`podnotes:feed-cache:v${version}`, "{}");
			const t = setup({ storage, enabled });
			t.repo.setSubscriptions({});

			await t.repo.ensureAll();

			expect(storage.values.has("podnotes:feed-cache:v5")).toBe(false);
			expect([...legacyStorage.keys()]).toEqual([]);
		},
	);

	test.each([
		{ enabled: true, failing: "saveLocalStorage" },
		{ enabled: false, failing: "saveLocalStorage" },
		{ enabled: true, failing: "removeItem" },
		{ enabled: false, failing: "removeItem" },
		{ enabled: true, failing: "loadLocalStorage" },
	])(
		"a feed loads when its storage throws (cache on: $enabled, $failing throws)",
		async ({ enabled, failing }) => {
			vi.spyOn(console, "warn").mockImplementation(() => {});
			const fail = () => {
				throw new Error("storage unavailable");
			};
			const storage = new MemoryStorage();
			if (failing === "saveLocalStorage") storage.saveLocalStorage = fail;
			else if (failing === "loadLocalStorage") storage.loadLocalStorage = fail;
			else vi.stubGlobal("window", { localStorage: { removeItem: fail } });
			const t = setup({ storage, enabled });

			await loaded(t, { Alpha: alpha }, doc("Alpha", [item(1)]));

			expect(t.load).toHaveBeenCalledWith(alpha.url);
			expect(t.feed("Alpha")).toMatchObject({ status: "ready" });
			expect(t.titles("Alpha")).toEqual(["Episode 1"]);
		},
	);

	test("a cached feed still shows when earlier caches cannot be removed", () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const storage = new MemoryStorage();
		storage.saveLocalStorage(
			CACHE_KEY,
			JSON.stringify({
				[alpha.url]: {
					updatedAt: Date.UTC(2026, 9, 11),
					complete: true,
					channel: { title: "Alpha" },
					items: [item(1)],
				},
			}),
		);
		vi.stubGlobal("window", {
			localStorage: {
				removeItem: () => {
					throw new Error("storage unavailable");
				},
			},
		});
		const t = setup({ storage });
		t.repo.setSubscriptions({ Alpha: alpha });

		void t.repo.ensureAll();

		expect(t.load).not.toHaveBeenCalled();
		expect(t.titles("Alpha")).toEqual(["Episode 1"]);
	});

	test("removes the caches of earlier versions as soon as it is created, before any feed loads", () => {
		const storage = new MemoryStorage();
		storage.saveLocalStorage(
			"podnotes:feed-cache:v5",
			'{"https://private.test/feed.xml?auth=s3cret":{"updatedAt":1,"episodes":[]}}',
		);
		legacyStorage.set("podnotes:feed-cache:v4", "{}");

		const t = setup({ storage });

		expect(storage.values.has("podnotes:feed-cache:v5")).toBe(false);
		expect([...legacyStorage.keys()]).toEqual([]);
		expect(t.load).not.toHaveBeenCalled();
	});

	test("a feed link's episodes are named after its channel and never cached", async () => {
		const t = setup();
		t.repo.setSubscriptions({ Beta: beta });

		const episodes = t.repo.episodesAt(alpha.url);
		t.requests[0].respond.resolve(doc("Alpha Channel", [item(1)]));

		expect(await episodes).toEqual([
			expect.objectContaining({ podcastName: "Alpha Channel", feedUrl: alpha.url }),
		]);
		expect(Object.keys(t.cached())).toEqual([]);
	});

	test("a feed link for a subscribed feed shares its request", async () => {
		const t = setup();
		t.repo.setSubscriptions({ Alpha: alpha });
		const loading = t.repo.ensureAll();

		const episodes = t.repo.episodesAt(alpha.url);
		t.requests[0].respond.resolve(doc("Alpha Channel", [item(1)]));
		await loading;

		expect(t.load).toHaveBeenCalledTimes(1);
		expect((await episodes)[0].podcastName).toBe("Alpha Channel");
		expect(t.feed("Alpha")?.episodes[0].podcastName).toBe("Alpha");
	});

	test("episodes fall back to the podcast's artwork and URL", async () => {
		const t = setup();
		const own = item(1, {
			artworkUrl: "https://media.test/1.jpg",
			itemLink: "https://alpha.test/1",
		});
		await loaded(t, { Alpha: alpha }, doc("Alpha", [own, item(2)]));

		expect(t.feed("Alpha")?.episodes).toEqual([
			expect.objectContaining({ artworkUrl: own.artworkUrl, url: own.itemLink }),
			expect.objectContaining({ artworkUrl: alpha.artworkUrl, url: alpha.url }),
		]);
	});

	test("a pasted feed URL previews as a podcast", async () => {
		const t = setup();
		const preview = t.repo.channelAt({ url: alpha.url });
		t.requests[0].respond.resolve({
			feed: {
				title: "Alpha Channel",
				siteUrl: "https://alpha.test",
				description: "About Alpha",
				author: "Host",
			},
			episodes: [],
		});

		expect(await preview).toEqual({
			title: "Alpha Channel",
			url: alpha.url,
			artworkUrl: "",
			link: "https://alpha.test",
			description: "About Alpha",
			author: "Host",
		});
	});

	test("a feed link for a podcast shows the podcast loading", async () => {
		const t = setup();
		t.repo.setSubscriptions({ Alpha: alpha });

		const episodes = t.repo.episodesAt(alpha.url);
		expect(t.feed("Alpha")?.status).toBe("loading");
		t.requests[0].respond.resolve(doc("Alpha", [item(1)]));
		await episodes;

		expect(t.feed("Alpha")?.status).toBe("ready");
	});

	test("a feed that fails to load is logged without its URL", async () => {
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		const t = setup();

		const episodes = t.repo.episodesAt("https://private.test/feed.xml?auth=s3cret");
		t.requests[0].respond.reject(new Error("offline"));
		await expect(episodes).rejects.toThrow("offline");

		expect(logged).toHaveBeenCalled();
		expect(logged.mock.calls.flat().map(String).join(" ")).not.toContain("s3cret");
	});

	test("a feed link that fails without a reason still rejects with an error", async () => {
		const t = setup();
		const episodes = t.repo.episodesAt(alpha.url);
		t.requests[0].respond.reject(undefined);

		await expect(episodes).rejects.toBeInstanceOf(Error);
	});

	test("a saved private feed's channel is read through its private URL", async () => {
		const secretUrl = "https://private.test/feed.xml?auth=s3cret";
		const privateFeed = { ...alpha, url: privateFeedPlaceholder("Private"), urlSecretId: "id" };
		const t = setup({ resolveUrl: (feed) => (feed.urlSecretId ? secretUrl : null) });
		t.repo.setSubscriptions({ Private: privateFeed });

		const channel = t.repo.channelAt({ ...privateFeed });
		t.requests[0].respond.resolve(doc("Private Channel", [item(1)]));

		expect(await channel).toMatchObject({ title: "Private Channel", url: privateFeed.url });
		expect(t.load).toHaveBeenCalledWith(secretUrl);
		expect(t.titles("Private")).toEqual(["Episode 1"]);
	});

	test("a feed link that cannot load rejects", async () => {
		const t = setup();
		const episodes = t.repo.episodesAt(alpha.url);
		t.requests[0].respond.reject(new Error("offline"));

		await expect(episodes).rejects.toThrow("offline");
	});

	test("an item URL resolves against the feed's URL, absolute ones stay as they are, and fragments go", () => {
		const t = setup();
		t.repo.setSubscriptions({ Alpha: { ...alpha, url: "https://alpha.test/show/feed.xml" } });

		expect(t.repo.itemUrl("Alpha", "t.vtt")).toBe("https://alpha.test/show/t.vtt");
		expect(t.repo.itemUrl("Alpha", "../t.vtt")).toBe("https://alpha.test/t.vtt");
		expect(t.repo.itemUrl("Alpha", "/t.vtt")).toBe("https://alpha.test/t.vtt");
		expect(t.repo.itemUrl("Alpha", "t.vtt#cue-3")).toBe("https://alpha.test/show/t.vtt");
		expect(t.repo.itemUrl("Alpha", "https://cdn.test/a b.vtt?v=2")).toBe(
			"https://cdn.test/a b.vtt?v=2",
		);
		expect(t.repo.itemUrl("Alpha", "https://cdn.test/t.vtt#cue-3")).toBe(
			"https://cdn.test/t.vtt",
		);
	});

	test("a private feed's item URL resolves against the secret URL only resolveUrl knows", () => {
		const secretUrl = "https://private.test/s3cret/feed.xml?auth=s3cret";
		const placeholder = privateFeedPlaceholder("Private");
		const t = setup({ resolveUrl: (feed) => (feed.url === placeholder ? secretUrl : null) });
		t.repo.setSubscriptions({ Private: { ...alpha, url: placeholder, urlSecretId: "id" } });

		expect(t.repo.itemUrl("Private", "t.vtt")).toBe("https://private.test/s3cret/t.vtt");
		expect(t.repo.itemUrl("Private", "/t.vtt")).toBe("https://private.test/t.vtt");
	});

	test("a relative item URL has no address when the private feed's URL is not on this device", () => {
		const t = setup({ resolveUrl: () => null });
		t.repo.setSubscriptions({
			Private: { ...alpha, url: privateFeedPlaceholder("Private"), urlSecretId: "id" },
		});

		expect(t.repo.itemUrl("Private", "t.vtt")).toBeUndefined();
		expect(t.repo.itemUrl("Unsubscribed", "t.vtt")).toBeUndefined();
		expect(t.repo.itemUrl("Private", "https://cdn.test/t.vtt")).toBe("https://cdn.test/t.vtt");
	});
});
