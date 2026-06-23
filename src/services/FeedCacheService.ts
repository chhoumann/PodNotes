import { get } from "svelte/store";
import { plugin } from "../store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";

type SerializableEpisode = Omit<Episode, "episodeDate"> & {
	episodeDate?: string;
};

interface CachedFeedData {
	episodes: SerializableEpisode[];
	updatedAt: number;
}

type FeedCache = Record<string, CachedFeedData>;

// v2: Episode gained episodeNumber/duration (#34, #88).
// v3: retention changed from "first N in feed order" to "newest N by date"
// (#114). An unexpired v2 entry written by the old code holds the first 75 feed
// items, which for an oldest-first feed are the OLDEST episodes; reading it after
// an upgrade would keep Latest Episodes/search stuck on stale items until the TTL
// expired. Bumping the key forces a fresh parse so the new retention applies
// immediately. Superseded keys are actively deleted on load (see
// LEGACY_STORAGE_KEYS) so a stale blob can't linger and eat the localStorage quota.
// v4: Episode gained mediaType (#78), sourced from enclosure MIME/path parsing.
// Dropping v3 prevents cached extensionless video enclosures from continuing to
// render as audio until the TTL expires.
// v5: storage moved from the raw (vault-agnostic) localStorage to the vault-scoped
// App#saveLocalStorage / App#loadLocalStorage, so a feed cache can no longer leak
// across vaults. The v1-v4 blobs were written to raw localStorage under
// un-prefixed keys, so they are purged from there directly (see removeLegacyCaches).
const STORAGE_KEY = "podnotes:feed-cache:v5";
// Storage keys from earlier cache schemas. They were written to the raw
// localStorage under these un-prefixed keys, so they are removed from there on
// first load so they don't orphan ~MBs of data (which could push current writes
// over the localStorage quota).
const LEGACY_STORAGE_KEYS = [
	"podnotes:feed-cache:v1",
	"podnotes:feed-cache:v2",
	"podnotes:feed-cache:v3",
	"podnotes:feed-cache:v4",
];
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours.
// Keep this >= MAX_EPISODE_LIST_LIMIT (src/constants.ts): the Latest Episodes
// list is rebuilt from this persisted cache on a warm start, so a per-feed list
// limit larger than what we retain here could never be served (issue #114).
const MAX_EPISODES_PER_FEED = 75;
const MAX_CACHE_SIZE_BYTES = 4 * 1024 * 1024; // 4MB to leave room for other localStorage usage

let cache: FeedCache | null = null;

// The subset of the Storage API the cache needs. Lets getStorage return either
// the vault-scoped App local-storage adapter or the raw window.localStorage
// fallback behind one shape.
interface FeedCacheStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

// Delete every superseded cache schema key. The v1-v4 blobs predate the move to
// App#saveLocalStorage and live under un-prefixed keys in the raw localStorage,
// so they are removed from there directly (the vault-scoped App store can't see
// them). Per-key try/catch so one failure can't block the others, and so this is
// safe even where localStorage is unavailable. Runs on first load and on explicit
// clear so the legacy blob is removed regardless of which path the user hits first.
function removeLegacyCaches(): void {
	let raw: Storage | null;
	try {
		raw = typeof window !== "undefined" ? window.localStorage : null;
	} catch {
		raw = null;
	}
	if (!raw) return;

	for (const legacyKey of LEGACY_STORAGE_KEYS) {
		try {
			raw.removeItem(legacyKey);
		} catch (error) {
			console.error("Failed to remove legacy feed cache key:", error);
		}
	}
}

// Prefer the vault-scoped App local storage (App#loadLocalStorage /
// App#saveLocalStorage) so one vault's feed cache can never leak into another.
// Obsidian namespaces the key per vault for us. Fall back to window.localStorage
// only when the plugin instance isn't available (very early calls, or non-plugin
// test contexts) so caching degrades gracefully instead of throwing.
function getStorage(): FeedCacheStorage | null {
	const app = get(plugin)?.app;
	if (
		app &&
		typeof app.loadLocalStorage === "function" &&
		typeof app.saveLocalStorage === "function"
	) {
		return {
			getItem: (key) => {
				const value = app.loadLocalStorage(key);
				return typeof value === "string" ? value : null;
			},
			setItem: (key, value) => app.saveLocalStorage(key, value),
			removeItem: (key) => app.saveLocalStorage(key, null),
		};
	}

	try {
		return typeof window !== "undefined" && window.localStorage
			? window.localStorage
			: null;
	} catch (error) {
		console.error("Unable to access localStorage for feed cache:", error);
		return null;
	}
}

function loadCache(): FeedCache {
	if (cache) {
		return cache;
	}

	// Cleanup of superseded raw-localStorage cache schemas so they don't linger
	// (a stale ~4MB v1 blob could otherwise eat the localStorage quota). Runs
	// regardless of the active backend, since the legacy blobs are always raw.
	removeLegacyCaches();

	const storage = getStorage();
	if (!storage) {
		cache = {};
		return cache;
	}

	try {
		const raw = storage.getItem(STORAGE_KEY);
		if (!raw) {
			cache = {};
			return cache;
		}

		const parsed = JSON.parse(raw) as FeedCache;
		cache = parsed;
		return cache;
	} catch (error) {
		console.error("Failed to parse feed cache:", error);
		cache = {};
		return cache;
	}
}

function evictOldestEntries(cacheData: FeedCache, targetSizeBytes: number): FeedCache {
	const entries = Object.entries(cacheData);

	// Sort by updatedAt ascending (oldest first)
	entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);

	const result: FeedCache = {};
	let currentSize = 0;

	// Add entries from newest to oldest until we exceed target size
	for (let i = entries.length - 1; i >= 0; i--) {
		const [key, value] = entries[i];
		const entrySize = JSON.stringify({ [key]: value }).length;

		if (currentSize + entrySize <= targetSizeBytes) {
			result[key] = value;
			currentSize += entrySize;
		}
	}

	return result;
}

function persistCache(): void {
	const storage = getStorage();
	if (!storage || !cache) {
		return;
	}

	try {
		let serialized = JSON.stringify(cache);

		// If cache is too large, evict oldest entries
		if (serialized.length > MAX_CACHE_SIZE_BYTES) {
			console.warn(
				`Feed cache size (${serialized.length} bytes) exceeds limit, evicting old entries`,
			);
			cache = evictOldestEntries(cache, MAX_CACHE_SIZE_BYTES * 0.8); // Target 80% of max
			serialized = JSON.stringify(cache);
		}

		storage.setItem(STORAGE_KEY, serialized);
	} catch (error) {
		// Handle quota exceeded error specifically
		if (
			error instanceof DOMException &&
			(error.name === "QuotaExceededError" ||
				error.name === "NS_ERROR_DOM_QUOTA_REACHED")
		) {
			console.warn("localStorage quota exceeded, clearing feed cache");
			try {
				// Clear cache and try again with empty cache
				cache = {};
				storage.setItem(STORAGE_KEY, "{}");
			} catch {
				// If we still can't write, just clear the item
				storage.removeItem(STORAGE_KEY);
			}
		} else {
			console.error("Failed to persist feed cache:", error);
		}
	}
}

function serializeEpisode(episode: Episode): SerializableEpisode {
	return {
		...episode,
		episodeDate: episode.episodeDate?.toISOString(),
	};
}

function episodeTimestamp(episode: Episode): number {
	if (!episode.episodeDate) return 0;
	const time = new Date(episode.episodeDate).getTime();
	return Number.isNaN(time) ? 0 : time;
}

/**
 * Keep the newest `limit` episodes by date while preserving their original
 * relative order. Selecting by date (not the first N in feed order) ensures an
 * oldest-first feed still caches its NEWEST episodes, so a warm-cache rebuild of
 * the Latest Episodes list isn't stuck on stale items (#114). Feeds at or under
 * the limit are returned untouched, so ordering for the common case is unchanged.
 */
function selectNewestEpisodes(episodes: Episode[], limit: number): Episode[] {
	if (episodes.length <= limit) return episodes;

	const keptIndices = new Set(
		episodes
			.map((episode, index) => ({ index, time: episodeTimestamp(episode) }))
			.sort((a, b) => b.time - a.time)
			.slice(0, limit)
			.map((entry) => entry.index),
	);

	return episodes.filter((_, index) => keptIndices.has(index));
}

function deserializeEpisode(episode: SerializableEpisode): Episode {
	return {
		...episode,
		episodeDate: episode.episodeDate ? new Date(episode.episodeDate) : undefined,
	};
}

function getFeedKey(feed: PodcastFeed): string {
	return feed.url ?? feed.title;
}

export function getCachedEpisodes(
	feed: PodcastFeed,
	maxAgeMs: number = DEFAULT_TTL_MS,
): Episode[] | null {
	const store = loadCache();
	const cacheKey = getFeedKey(feed);
	const cachedValue = store[cacheKey];

	if (!cachedValue) {
		return null;
	}

	const isExpired = Date.now() - cachedValue.updatedAt > maxAgeMs;
	if (isExpired) {
		delete store[cacheKey];
		persistCache();
		return null;
	}

	return cachedValue.episodes.map(deserializeEpisode);
}

export function setCachedEpisodes(feed: PodcastFeed, episodes: Episode[]): void {
	if (!episodes.length) {
		return;
	}

	const store = loadCache();
	const cacheKey = getFeedKey(feed);

	store[cacheKey] = {
		updatedAt: Date.now(),
		episodes: selectNewestEpisodes(episodes, MAX_EPISODES_PER_FEED).map(
			serializeEpisode,
		),
	};

	persistCache();
}

export function clearFeedCache(): void {
	cache = {};
	const storage = getStorage();
	if (storage) {
		try {
			storage.removeItem(STORAGE_KEY);
		} catch (error) {
			console.error("Failed to clear feed cache:", error);
		}
	}
	// Also drop legacy keys here: a clear issued before any loadCache() would
	// otherwise leave them (the in-memory memo then short-circuits loadCache).
	removeLegacyCaches();
}
