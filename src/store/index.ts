import { get, readable, writable } from "svelte/store";
import type PodNotes from "src/main";
import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import type { Playlist } from "src/types/Playlist";
import { ViewState } from "src/types/ViewState";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import { TFile } from "obsidian";
import type { LocalEpisode } from "src/types/LocalEpisode";
import type { PlaybackSegment } from "src/types/PlaybackSegment";
import {
	DEFAULT_EPISODE_LIST_LIMIT,
	LOCAL_FILES_SETTINGS,
	MAX_EPISODE_LIST_LIMIT,
} from "src/constants";
import { getEpisodeKey } from "src/utility/episodeKey";
import {
	getPlayedEpisode,
	getPlayedEpisodeAliasKeys,
} from "src/utility/episodeStatus";

export const plugin = writable<PodNotes>();
export const currentTime = writable<number>(0);
export const requestedPlaybackTime = writable<{
	episodeKey: string;
	time: number;
	endTime?: number;
} | null>(null);
export const activePlaybackSegment = writable<PlaybackSegment | null>(null);
export const duration = writable<number>(0);
export const volume = writable<number>(1);
export const hidePlayedEpisodes = writable<boolean>(false);

export const currentEpisode = (() => {
	const store = writable<Episode>();
	const { subscribe, update } = store;

	return {
		subscribe,
		update,
		set: (newEpisode: Episode, addPrevToQueue = true) => {
			update((previousEpisode) => {
				if (previousEpisode) {
					if (addPrevToQueue) {
						addEpisodeToQueue(previousEpisode);
					}

					const ct = get(currentTime);
					const dur = get(duration);
					// A zero/unknown duration is never a finished episode. The player
					// resets currentTime/duration to 0 the instant the episode changes
					// (issue #94); if the user switches away again before the next
					// episode's metadata loads, ct === dur === 0 would otherwise persist
					// a never-played episode as finished at 0:00 and surface it as played.
					const isFinished = dur > 0 && ct === dur;
					playedEpisodes.setEpisodeTime(previousEpisode, ct, dur, isFinished);
				}

				return newEpisode;
			});
		},
	};
})();

export const isPaused = writable<boolean>(true);
export const playedEpisodes = (() => {
	const store = writable<{ [key: string]: PlayedEpisode }>({});
	const { subscribe, update, set } = store;

	return {
		subscribe,
		set,
		update,
		/**
		 * Gets played episode data with backwards compatibility.
		 */
		get: (episode: Episode): PlayedEpisode | undefined => {
			return getPlayedEpisode(get(store), episode);
		},
		setEpisodeTime: (
			episode: Episode | null | undefined,
			time: number,
			duration: number,
			finished: boolean,
		) => {
			if (!episode) return;

			update((playedEpisodes) => {
				const key = getEpisodeKey(episode);
				if (!key) return playedEpisodes;

				playedEpisodes[key] = {
					title: episode.title,
					podcastName: episode.podcastName,
					time,
					duration,
					finished,
				};

				return playedEpisodes;
			});
		},
		markAsPlayed: (episode: Episode | null | undefined) => {
			if (!episode) return;

			update((playedEpisodes) => {
				const key = getEpisodeKey(episode);
				if (!key) return playedEpisodes;

				const playedEpisode = getPlayedEpisode(playedEpisodes, episode) || {
					title: episode.title,
					podcastName: episode.podcastName,
					time: 0,
					duration: 0,
					finished: false,
				};

				playedEpisode.time = playedEpisode.duration;
				playedEpisode.finished = true;

				playedEpisodes[key] = playedEpisode;
				return playedEpisodes;
			});
		},
		markAsUnplayed: (episode: Episode | null | undefined) => {
			if (!episode) return;

			update((playedEpisodes) => {
				const key = getEpisodeKey(episode);
				if (!key) return playedEpisodes;

				markPlayedEpisodeAliasesAsUnplayed(
					playedEpisodes,
					{
						title: episode.title,
						podcastName: episode.podcastName,
					},
					key,
				);
				return playedEpisodes;
			});
		},
		markKeyAsUnplayed: (key: string) => {
			if (!key) return;

			update((playedEpisodes) => {
				const playedEpisode = playedEpisodes[key];
				if (!playedEpisode) return playedEpisodes;

				markPlayedEpisodeAliasesAsUnplayed(playedEpisodes, playedEpisode, key);
				return playedEpisodes;
			});
		},
	};
})();

function markPlayedEpisodeAliasesAsUnplayed(
	playedEpisodeMap: { [key: string]: PlayedEpisode },
	episode: Pick<PlayedEpisode, "title" | "podcastName">,
	preferredKey: string,
) {
	const aliasKeys = getPlayedEpisodeAliasKeys(
		playedEpisodeMap,
		episode,
		preferredKey,
	);
	const keysToUpdate = aliasKeys.length > 0 ? aliasKeys : [preferredKey];

	for (const key of keysToUpdate) {
		const playedEpisode = playedEpisodeMap[key] || {
			title: episode.title,
			podcastName: episode.podcastName,
			time: 0,
			duration: 0,
			finished: false,
		};

		playedEpisodeMap[key] = {
			...playedEpisode,
			time: 0,
			finished: false,
		};
	}
}

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

	return Number(episode.episodeDate);
}

function getLatestEpisodesForFeed(
	episodes: Episode[],
	perFeedLimit: number,
): Episode[] {
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

	return currentLatest.filter(
		(episode) => !feedKeys.has(latestEpisodeIdentifier(episode)),
	);
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
				nextMerged = removeFeedEntries(
					nextMerged,
					latestByFeed.get(feedTitle),
				);
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
			const nextLatestForFeed = getLatestEpisodesForFeed(
				episodes,
				perFeedLimit,
			);
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

export const downloadedEpisodes = (() => {
	const store = writable<{ [podcastName: string]: DownloadedEpisode[] }>({});
	const { subscribe, update, set } = store;

	function isEpisodeDownloaded(episode: Episode): boolean {
		return get(store)[episode.podcastName]?.some(
			(e) => e.title === episode.title,
		);
	}

	return {
		subscribe,
		set,
		update,
		isEpisodeDownloaded,
		addEpisode: (episode: Episode, filePath: string, size: number) => {
			update(
				(downloadedEpisodes: {
					[podcastName: string]: DownloadedEpisode[];
				}) => {
					const podcastEpisodes = downloadedEpisodes[episode.podcastName] || [];

					const idx = podcastEpisodes.findIndex(
						(ep) => ep.title === episode.title,
					);
					if (idx !== -1) {
						podcastEpisodes[idx] = { ...episode, filePath, size };
					} else {
						podcastEpisodes.push({
							...episode,
							filePath,
							size,
						});
					}

					downloadedEpisodes[episode.podcastName] = podcastEpisodes;
					return downloadedEpisodes;
				},
			);
		},
		removeEpisode: (episode: Episode, removeFile: boolean) => {
			update((downloadedEpisodes) => {
				const podcastEpisodes = downloadedEpisodes[episode.podcastName] || [];
				const index = podcastEpisodes.findIndex(
					(e) => e.title === episode.title,
				);

				// Guard against episode not found
				if (index === -1) {
					return downloadedEpisodes;
				}

				const filePath = podcastEpisodes[index].filePath;
				podcastEpisodes.splice(index, 1);

				if (removeFile && filePath) {
					try {
						// @ts-ignore: app is not defined in the global scope anymore, but is still
						// available. Need to fix this later
						const file = app.vault.getAbstractFileByPath(filePath);

						if (file instanceof TFile) {
							// @ts-ignore
							app.vault.delete(file);
						}
					} catch (error) {
						console.error(error);
					}
				}

				downloadedEpisodes[episode.podcastName] = podcastEpisodes;
				return downloadedEpisodes;
			});
		},
		getEpisode: (episode: Episode) => {
			return get(store)[episode.podcastName]?.find(
				(e) => e.title === episode.title,
			);
		},
	};
})();

/**
 * Returns a new array with the episode at `from` moved to position `to`.
 *
 * Any out-of-range, negative, or equal index pair is treated as a no-op and the
 * original array reference is returned unchanged, so callers can cheaply detect
 * "nothing moved" and skip a store write. Guarding `from < 0` is essential: a
 * `findIndex` miss yields -1, and `splice(-1, 1)` would destructively remove the
 * last element.
 */
export function reorderEpisodes(
	episodes: Episode[],
	from: number,
	to: number,
): Episode[] {
	const length = episodes.length;
	if (from < 0 || from >= length || to < 0 || to >= length || from === to) {
		return episodes;
	}

	const next = [...episodes];
	const [moved] = next.splice(from, 1);
	next.splice(to, 0, moved);
	return next;
}

/**
 * Returns the episodes with later duplicate titles removed, preserving order and
 * the first occurrence. The queue is title-identified everywhere, so this keeps
 * it title-unique regardless of how it was populated — including queues
 * persisted or synced before dedup-on-add existed.
 */
export function dedupeEpisodesByTitle(episodes: Episode[] = []): Episode[] {
	const seen = new Set<string>();
	const result: Episode[] = [];

	for (const episode of episodes) {
		if (seen.has(episode.title)) continue;

		seen.add(episode.title);
		result.push(episode);
	}

	return result;
}

export const queue = (() => {
	const store = writable<Playlist>({
		icon: "list-ordered",
		name: "Queue",
		episodes: [],
		shouldEpisodeRemoveAfterPlay: true,
		shouldRepeat: false,
	});
	const { subscribe, update, set: setStore } = store;

	// The queue identifies episodes by title everywhere (remove, played-cleanup,
	// context menu). Keeping it title-unique on add makes those lookups — and the
	// reorder index lookups below — unambiguous.
	const isAlreadyQueued = (episodes: Episode[], episode: Episode) =>
		episodes.some((e) => e.title === episode.title);

	function move(from: number, to: number) {
		const { episodes } = get(store);
		const reordered = reorderEpisodes(episodes, from, to);

		// No-op move: skip the store write so we don't churn saveSettings.
		if (reordered === episodes) return;

		update((queue) => {
			queue.episodes = reordered;
			return queue;
		});
	}

	return {
		subscribe,
		update,
		// Enforce the title-unique invariant on every set (load, import, sync),
		// not just on incremental adds.
		set: (playlist: Playlist) =>
			setStore({
				...playlist,
				episodes: dedupeEpisodesByTitle(playlist.episodes),
			}),
		add: (episode: Episode) => {
			update((queue) => {
				if (isAlreadyQueued(queue.episodes, episode)) return queue;

				queue.episodes.push(episode);
				return queue;
			});
		},
		remove: (episode: Episode) => {
			update((queue) => {
				queue.episodes = queue.episodes.filter(
					(e) => e.title !== episode.title,
				);
				return queue;
			});
		},
		playNext: () => {
			// Auto-advance is part of queue automation (issue #108): when the user
			// has turned the queue off, finishing an episode must not pull the next
			// one in. The manual queue is left intact for when they re-enable it.
			if (!autoQueueEnabled()) return;

			update((queue) => {
				const nextEp = queue.episodes.shift();

				if (nextEp) {
					currentEpisode.set(nextEp, false);
				}

				return queue;
			});
		},
		move,
		moveUp: (index: number) => move(index, index - 1),
		moveDown: (index: number) => move(index, index + 1),
		moveToTop: (index: number) => move(index, 0),
		moveToBottom: (index: number) =>
			move(index, get(store).episodes.length - 1),
	};
})();

export const favorites = writable<Playlist>({
	icon: "lucide-star",
	name: "Favorites",
	episodes: [],
	shouldEpisodeRemoveAfterPlay: false,
	shouldRepeat: false,
});

function sameEpisodeKeySet(a: Episode[], b: Episode[]): boolean {
	if (a.length !== b.length) return false;

	const keysInA = new Set(a.map(getEpisodeKey));
	for (const episode of b) {
		if (!keysInA.has(getEpisodeKey(episode))) return false;
	}

	return true;
}

export const localFiles = (() => {
	const store = writable<Playlist>({
		icon: "folder",
		name: "Local Files",
		episodes: [],
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
	});

	const { subscribe, update, set } = store;

	return {
		subscribe,
		update,
		set,
		/**
		 * Mirrors downloadedEpisodes into the Local Files playlist (issue #176).
		 *
		 * downloadedEpisodes is the authoritative set of offline-available episodes:
		 * downloads (createEpisodeFile) and manual local files (getContextMenuHandler)
		 * both write there. Entries are copied verbatim so filePath/size and the real
		 * podcastName survive — playback resolves the local file from downloadedEpisodes
		 * keyed by podcastName::title, so coercing podcastName would break it.
		 *
		 * This is a pure projection: it intentionally drops any pre-existing localFiles
		 * entry that is absent from downloadedEpisodes (stale/removed files). Playable
		 * files are always present in downloadedEpisodes via the download flow and the
		 * dual-write in getContextMenuHandler, so nothing reachable is lost — and a
		 * removed download now correctly disappears from Local Files too.
		 */
		syncWithDownloaded: (downloaded: {
			[podcastName: string]: DownloadedEpisode[];
		}): void => {
			const seen = new Set<string>();
			const episodes: Episode[] = [];

			for (const episode of Object.values(downloaded).flat()) {
				const key = getEpisodeKey(episode);
				if (!key || seen.has(key)) continue;

				seen.add(key);
				episodes.push(episode);
			}

			// Skip the store write entirely when membership is unchanged. Returning the
			// same object from update() would still notify subscribers (Svelte treats
			// every object value as changed), re-running LocalFilesController.onChange and
			// saveSettings on every unrelated downloadedEpisodes mutation and the
			// load-time immediate-fire. Comparing before touching the store avoids that.
			if (sameEpisodeKeySet(get(store).episodes, episodes)) {
				return;
			}

			update((playlist) => ({ ...playlist, ...LOCAL_FILES_SETTINGS, episodes }));
		},
		getLocalEpisode: (title: string): LocalEpisode | undefined => {
			const { episodes } = get(store);

			// Prefer a genuine manual local file so a same-titled downloaded episode
			// (now mirrored into this playlist) can't shadow it in deep-links.
			const ep =
				episodes.find(
					(episode) =>
						episode.title === title && episode.podcastName === "local file",
				) ?? episodes.find((episode) => episode.title === title);

			return ep as LocalEpisode | undefined;
		},
		updateStreamUrl: (title: string, newUrl: string): void => {
			store.update((playlist) => {
				const idx = playlist.episodes.findIndex((ep) => ep.title === title);

				if (idx !== -1) playlist.episodes[idx].streamUrl = newUrl;

				return playlist;
			});
		},
		// NOTE: the Local Files playlist is now a projection of downloadedEpisodes
		// (see syncWithDownloaded). Add files by writing to downloadedEpisodes; a direct
		// imperative add here would be overwritten by the next mirror pass.
	};
})();

export const playlists = writable<{ [name: string]: Playlist }>({});

export const podcastView = writable<HTMLDivElement>();
export const viewState = (() => {
	const store = writable<ViewState>(ViewState.PodcastGrid);
	const { subscribe, set } = store;

	return {
		subscribe,
		set: (newState: ViewState) => {
			set(newState);

			get(podcastView)?.scrollIntoView();
		},
	};
})();

/**
 * Whether the queue's automatic behavior is enabled (issue #108). Gates both
 * auto-population (enqueuing the episode you switch away from) and auto-advance
 * (queue.playNext on episode end). Reads the live plugin setting on each call so
 * toggling takes effect without a reload. Defaults to enabled so a missing
 * setting or an uninitialised plugin store preserves the historical behavior.
 */
function autoQueueEnabled(): boolean {
	return get(plugin)?.settings?.autoQueue !== false;
}

function addEpisodeToQueue(episode: Episode) {
	// Gate at the operation, not the call site, so no future caller can bypass it.
	if (!autoQueueEnabled()) return;

	queue.update((playlist) => {
		// Keep the queue title-unique: a previously-played episode that is already
		// queued stays in place rather than being re-prepended.
		if (playlist.episodes.some((e) => e.title === episode.title)) {
			return playlist;
		}

		const newEpisodes = [episode, ...playlist.episodes];
		playlist.episodes = newEpisodes;

		return playlist;
	});
}
