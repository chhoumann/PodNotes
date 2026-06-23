import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { plugin } from "../store";
import type PodNotes from "../main";
import {
	clearFeedCache,
	getCachedEpisodes,
	setCachedEpisodes,
} from "./FeedCacheService";

const testFeed: PodcastFeed = {
	title: "Accidental Tech Podcast",
	url: "https://pod.example.com/feed.xml",
	artworkUrl: "https://pod.example.com/art.jpg",
};

function createEpisode(number: number): Episode {
	return {
		title: `Episode ${number}`,
		streamUrl: `https://pod.example.com/ep-${number}.mp3`,
		url: `https://pod.example.com/ep-${number}`,
		description: `Description for episode ${number}`,
		content: `<p>Episode ${number}</p>`,
		podcastName: testFeed.title,
		artworkUrl: testFeed.artworkUrl,
		episodeDate: new Date(`2024-01-${String((number % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
	};
}

describe("FeedCacheService", () => {
	beforeEach(() => {
		clearFeedCache();
	});

	// `number` doubles as the day, so a higher number is a newer episode.
	function datedEpisode(number: number): Episode {
		return {
			...createEpisode(number),
			title: `Episode ${number}`,
			episodeDate: new Date(2024, 0, number),
		};
	}

	test("persists at most 75 newest episodes per feed (#124 cap)", () => {
		// Newest-first feed (100 -> 1); the newest 75 are episodes 100..26.
		const episodes = Array.from({ length: 100 }, (_, index) =>
			datedEpisode(100 - index),
		);

		setCachedEpisodes(testFeed, episodes);

		const cached = getCachedEpisodes(testFeed);
		expect(cached).toHaveLength(75);
		// Original (newest-first) order is preserved among the retained episodes.
		expect(cached?.[0]?.title).toBe("Episode 100");
		expect(cached?.[74]?.title).toBe("Episode 26");
		expect(cached?.some((episode) => episode.title === "Episode 25")).toBe(
			false,
		);
		expect(cached?.some((episode) => episode.title === "Episode 1")).toBe(
			false,
		);
	});

	test("retains the newest episodes when the feed is oldest-first (#114)", () => {
		// Oldest-first feed (1 -> 100): the cache must keep the NEWEST 75 (26..100),
		// not the first 75 in feed order, or a warm-cache Latest Episodes rebuild
		// would surface stale episodes.
		const episodes = Array.from({ length: 100 }, (_, index) =>
			datedEpisode(index + 1),
		);

		setCachedEpisodes(testFeed, episodes);

		const cached = getCachedEpisodes(testFeed);
		expect(cached).toHaveLength(75);
		expect(cached?.some((episode) => episode.title === "Episode 100")).toBe(
			true,
		);
		expect(cached?.some((episode) => episode.title === "Episode 26")).toBe(
			true,
		);
		expect(cached?.some((episode) => episode.title === "Episode 25")).toBe(
			false,
		);
		expect(cached?.some((episode) => episode.title === "Episode 1")).toBe(
			false,
		);
		// Original (oldest-first) order is preserved among the retained episodes.
		expect(cached?.[0]?.title).toBe("Episode 26");
		expect(cached?.[74]?.title).toBe("Episode 100");
	});

	test("returns persisted episodes within TTL", () => {
		const episodes = [createEpisode(1), createEpisode(2)];

		setCachedEpisodes(testFeed, episodes);

		expect(getCachedEpisodes(testFeed)).toEqual(episodes);
	});

	test("round-trips episodeNumber, duration, and mediaType (#34, #88, #78)", () => {
		const episode: Episode = {
			...createEpisode(1),
			episodeNumber: 42,
			duration: 3723,
			mediaType: "video",
		};

		setCachedEpisodes(testFeed, [episode]);

		const cached = getCachedEpisodes(testFeed);
		expect(cached?.[0]?.episodeNumber).toBe(42);
		expect(cached?.[0]?.duration).toBe(3723);
		expect(cached?.[0]?.mediaType).toBe("video");
	});

	test("removes the superseded v1 cache key on first load", async () => {
		localStorage.setItem(
			"podnotes:feed-cache:v1",
			JSON.stringify({ stale: { episodes: [], updatedAt: 0 } }),
		);

		// Re-import so the module's one-time first load runs against a fresh
		// in-memory cache (the module memoizes after the first read).
		vi.resetModules();
		const fresh = await import("./FeedCacheService");
		fresh.getCachedEpisodes(testFeed);

		expect(localStorage.getItem("podnotes:feed-cache:v1")).toBeNull();
	});

	test("removes the superseded v2 cache key on first load (#114 retention change)", async () => {
		// The v2 schema kept the first N episodes in feed order; v3 keeps the newest
		// N by date. An unexpired v2 blob must be dropped on upgrade so an
		// oldest-first feed doesn't keep serving stale episodes until the TTL.
		localStorage.setItem(
			"podnotes:feed-cache:v2",
			JSON.stringify({ stale: { episodes: [], updatedAt: 0 } }),
		);

		vi.resetModules();
		const fresh = await import("./FeedCacheService");
		fresh.getCachedEpisodes(testFeed);

		expect(localStorage.getItem("podnotes:feed-cache:v2")).toBeNull();
	});

	test("removes the superseded v3 cache key on first load (#78 media type change)", async () => {
		// v3 entries can contain extensionless video enclosures parsed before
		// Episode.mediaType existed, so they must be dropped on upgrade.
		localStorage.setItem(
			"podnotes:feed-cache:v3",
			JSON.stringify({ stale: { episodes: [], updatedAt: 0 } }),
		);

		vi.resetModules();
		const fresh = await import("./FeedCacheService");
		fresh.getCachedEpisodes(testFeed);

		expect(localStorage.getItem("podnotes:feed-cache:v3")).toBeNull();
	});

	test("clearFeedCache also removes superseded legacy keys", () => {
		// Covers a clear issued before any cache load, where loadCache's memo would
		// otherwise short-circuit and leave the v1 blob behind.
		localStorage.setItem("podnotes:feed-cache:v1", "{}");
		localStorage.setItem("podnotes:feed-cache:v3", "{}");
		clearFeedCache();
		expect(localStorage.getItem("podnotes:feed-cache:v1")).toBeNull();
		expect(localStorage.getItem("podnotes:feed-cache:v3")).toBeNull();
	});
});

// Exercises the production path: when the plugin instance is available, the cache
// goes through the vault-scoped App#loadLocalStorage / App#saveLocalStorage rather
// than the raw window.localStorage fallback used by the other tests.
describe("App-backed (vault-scoped) storage", () => {
	test("persists, reads, and clears via App#load/saveLocalStorage", async () => {
		const backing = new Map<string, string>();
		const app = {
			loadLocalStorage: (key: string) => backing.get(key) ?? null,
			saveLocalStorage: (key: string, value: string | null) => {
				if (value == null) backing.delete(key);
				else backing.set(key, value);
			},
		};
		plugin.set({ app } as unknown as PodNotes);
		clearFeedCache();

		const episodes = [createEpisode(1), createEpisode(2)];
		setCachedEpisodes(testFeed, episodes);

		// Written to the App store (vault-scoped), not raw window.localStorage.
		expect([...backing.keys()].some((key) => key.includes("feed-cache:v5"))).toBe(
			true,
		);

		// Read back on a COLD module so the read goes through App#loadLocalStorage
		// rather than the in-module memo.
		vi.resetModules();
		const freshStore = await import("../store");
		const freshSvc = await import("./FeedCacheService");
		(freshStore.plugin as typeof plugin).set({ app } as unknown as PodNotes);
		expect(freshSvc.getCachedEpisodes(testFeed)).toEqual(episodes);

		freshSvc.clearFeedCache();
		expect([...backing.keys()].some((key) => key.includes("feed-cache:v5"))).toBe(
			false,
		);

		plugin.set(undefined as unknown as PodNotes);
	});
});
