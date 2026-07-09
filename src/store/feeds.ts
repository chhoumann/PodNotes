import { get, readable, writable } from "svelte/store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { DEFAULT_EPISODE_LIST_LIMIT, MAX_EPISODE_LIST_LIMIT } from "src/constants";

/**
 * Saved-feed metadata, the per-feed episode cache, and the aggregated "Latest
 * Episodes" projection over that cache. Self-contained: this module owns the only
 * stores it reads, so it has no dependency on the rest of the store layer.
 */

/** Bumped whenever the set of podcasts/feeds changes, so views can refresh. */
export const podcastsUpdated = writable(0);

export const savedFeeds = writable<{ [podcastName: string]: PodcastFeed }>({});

export const episodeCache = writable<{ [podcastName: string]: Episode[] }>({});

/**
 * How many of each feed's most recent episodes the aggregated "Latest Episodes"
 * list keeps. Backed by the `episodeListLimit` setting; `main.ts` seeds it from
 * the loaded settings and the settings tab updates it live (issue #114).
 */
export const episodeListLimit = writable<number>(DEFAULT_EPISODE_LIST_LIMIT);

/**
 * Coerce a stored/raw limit into a usable positive integer, falling back to the
 * default for missing/NaN/zero/negative values and clamping the upper bound so a
 * stray huge number can't materialise an unbounded list.
 */
export function sanitizeEpisodeListLimit(value: unknown): number {
	const numeric = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(numeric) || numeric < 1) {
		return DEFAULT_EPISODE_LIST_LIMIT;
	}

	return Math.min(Math.floor(numeric), MAX_EPISODE_LIST_LIMIT);
}

type LatestEpisodesByFeed = Map<string, Episode[]>;
type FeedEpisodeSources = Map<string, Episode[]>;

function getEpisodeTimestamp(episode?: Episode): number {
	if (!episode?.episodeDate) return 0;

	// An Invalid Date coerces to NaN, which makes every comparison false and
	// produces an unstable/incorrect sort order. Collapse it to 0 (sorts as
	// oldest), matching FeedCacheService.episodeTimestamp (FP-12).
	const timestamp = Number(episode.episodeDate);
	return Number.isFinite(timestamp) ? timestamp : 0;
}

function getLatestEpisodesForFeed(episodes: Episode[], perFeedLimit: number): Episode[] {
	if (!episodes?.length) return [];

	// Sort by date first, THEN take the newest N. Slicing before sorting would
	// only keep the newest episodes when the feed is already newest-first; for a
	// feed (or cache) in any other order it would surface the wrong episodes, so
	// the per-feed limit must rank the whole feed before truncating (issue #114).
	return [...episodes]
		.sort((a, b) => getEpisodeTimestamp(b) - getEpisodeTimestamp(a))
		.slice(0, perFeedLimit);
}

function shallowEqualEpisodes(a?: Episode[], b?: Episode[]): boolean {
	if (!a || !b || a.length !== b.length) return false;

	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}

	return true;
}

const latestEpisodeIdentifier = (episode: Episode): string =>
	`${episode.podcastName}::${episode.title}`;

function insertEpisodeSorted(
	episodes: Episode[],
	episodeToInsert: Episode,
	limit: number,
): Episode[] {
	const nextEpisodes = [...episodes];
	const value = getEpisodeTimestamp(episodeToInsert);
	let low = 0;
	let high = nextEpisodes.length;

	while (low < high) {
		const mid = (low + high) >> 1;
		const midValue = getEpisodeTimestamp(nextEpisodes[mid]);

		if (value > midValue) {
			high = mid;
		} else {
			low = mid + 1;
		}
	}

	nextEpisodes.splice(low, 0, episodeToInsert);

	if (nextEpisodes.length > limit) {
		nextEpisodes.length = limit;
	}

	return nextEpisodes;
}

function removeFeedEntries(
	currentLatest: Episode[],
	feedEpisodes: Episode[] | undefined = [],
): Episode[] {
	if (!feedEpisodes?.length) {
		return currentLatest;
	}

	const feedKeys = new Set(feedEpisodes.map(latestEpisodeIdentifier));

	return currentLatest.filter((episode) => !feedKeys.has(latestEpisodeIdentifier(episode)));
}

function updateLatestEpisodesForFeed(
	currentLatest: Episode[],
	previousFeedEpisodes: Episode[] | undefined,
	nextFeedEpisodes: Episode[] | undefined,
	limit: number,
): Episode[] {
	let nextLatest = removeFeedEntries(currentLatest, previousFeedEpisodes);

	if (!nextFeedEpisodes?.length) {
		return nextLatest;
	}

	for (const episode of nextFeedEpisodes) {
		nextLatest = insertEpisodeSorted(nextLatest, episode, limit);
	}

	return nextLatest;
}

export const latestEpisodes = readable<Episode[]>([], (set) => {
	let latestByFeed: LatestEpisodesByFeed = new Map();
	let feedSources: FeedEpisodeSources = new Map();
	let mergedLatest: Episode[] = [];
	let perFeedLimit = sanitizeEpisodeListLimit(get(episodeListLimit));

	// Incremental update for the common case (a single feed's cache changing):
	// reuse each feed's already-computed slice and only re-merge what moved.
	function applyCache(cache: { [podcastName: string]: Episode[] }) {
		const cacheEntries = Object.entries(cache);
		const feedCount = cacheEntries.length;
		const latestLimit = Math.max(1, perFeedLimit * Math.max(feedCount, 1));

		let changed = false;
		let nextMerged = mergedLatest;
		const nextSources: FeedEpisodeSources = new Map();
		const nextLatestByFeed: LatestEpisodesByFeed = new Map();

		for (const [feedTitle, episodes] of cacheEntries) {
			nextSources.set(feedTitle, episodes);
			const previousSource = feedSources.get(feedTitle);
			const previousLatest = latestByFeed.get(feedTitle) || [];

			const nextLatestForFeed =
				previousSource === episodes && previousLatest
					? previousLatest
					: getLatestEpisodesForFeed(episodes, perFeedLimit);

			nextLatestByFeed.set(feedTitle, nextLatestForFeed);

			if (!shallowEqualEpisodes(previousLatest, nextLatestForFeed)) {
				changed = true;
				nextMerged = updateLatestEpisodesForFeed(
					nextMerged,
					previousLatest,
					nextLatestForFeed,
					latestLimit,
				);
			}
		}

		for (const feedTitle of latestByFeed.keys()) {
			if (!nextSources.has(feedTitle)) {
				changed = true;
				nextMerged = removeFeedEntries(nextMerged, latestByFeed.get(feedTitle));
			}
		}

		feedSources = nextSources;
		latestByFeed = nextLatestByFeed;

		if (changed) {
			mergedLatest = nextMerged;
			set(mergedLatest);
		}
	}

	// Changing the per-feed limit re-slices every feed, so the incremental reuse
	// above no longer holds. Drop the cached slices and rebuild from scratch; this
	// only runs when the `episodeListLimit` setting changes (issue #114).
	function rebuildForLimitChange() {
		const cache = get(episodeCache);
		const cacheEntries = Object.entries(cache);
		const feedCount = cacheEntries.length;
		const latestLimit = Math.max(1, perFeedLimit * Math.max(feedCount, 1));

		const nextSources: FeedEpisodeSources = new Map();
		const nextLatestByFeed: LatestEpisodesByFeed = new Map();
		const collected: Episode[] = [];

		for (const [feedTitle, episodes] of cacheEntries) {
			const nextLatestForFeed = getLatestEpisodesForFeed(episodes, perFeedLimit);
			nextSources.set(feedTitle, episodes);
			nextLatestByFeed.set(feedTitle, nextLatestForFeed);
			collected.push(...nextLatestForFeed);
		}

		// Merge once: sort the gathered per-feed slices by date and cap. A single
		// sort avoids the repeated full-array copies insertEpisodeSorted would do
		// per episode, keeping this user-triggered rebuild off the slow path.
		const nextMerged = collected
			.sort((a, b) => getEpisodeTimestamp(b) - getEpisodeTimestamp(a))
			.slice(0, latestLimit);

		feedSources = nextSources;
		latestByFeed = nextLatestByFeed;

		if (!shallowEqualEpisodes(mergedLatest, nextMerged)) {
			mergedLatest = nextMerged;
			set(mergedLatest);
		}
	}

	const unsubscribeCache = episodeCache.subscribe(applyCache);

	const unsubscribeLimit = episodeListLimit.subscribe((value) => {
		const nextLimit = sanitizeEpisodeListLimit(value);
		// Skip the immediate-fire (same value) and any no-op writes; only a real
		// change needs the full rebuild.
		if (nextLimit === perFeedLimit) return;
		perFeedLimit = nextLimit;
		rebuildForLimitChange();
	});

	return () => {
		latestByFeed.clear();
		feedSources.clear();
		mergedLatest = [];
		unsubscribeLimit();
		unsubscribeCache();
	};
});
