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

function persistCache(): void {
	const storage = getStorage();
	if (!storage) {
		return;
	}

	try {
		storage.setItem(STORAGE_KEY, JSON.stringify(cache ?? {}));
	} catch (error) {
		console.error("Failed to persist feed cache:", error);
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
