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

const STORAGE_KEY = "podnotes:feed-cache:v1";
const DEFAULT_TTL_MS = 1000 * 60 * 60 * 6; // 6 hours.
const MAX_EPISODES_PER_FEED = 75;
const MAX_CACHE_SIZE_BYTES = 4 * 1024 * 1024; // 4MB to leave room for other localStorage usage

let cache: FeedCache | null = null;

function getStorage(): Storage | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch (error) {
		console.error("Unable to access localStorage for feed cache:", error);
		return null;
	}
}

function loadCache(): FeedCache {
	if (cache) {
		return cache;
	}

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
		episodes: episodes
			.slice(0, MAX_EPISODES_PER_FEED)
			.map(serializeEpisode),
	};

	persistCache();
}

export function clearFeedCache(): void {
	cache = {};
	const storage = getStorage();
	try {
		storage?.removeItem(STORAGE_KEY);
	} catch (error) {
		console.error("Failed to clear feed cache:", error);
	}
}
