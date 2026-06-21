import { get, writable, type Unsubscriber } from "svelte/store";
import type PodNotes from "src/main";
import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type { Playlist } from "src/types/Playlist";
import { ViewState } from "src/types/ViewState";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import type { PlaybackSegment } from "src/types/PlaybackSegment";
import { LOCAL_FILES_SETTINGS } from "src/constants";
import { DEFAULT_PLAYBACK_RATE } from "src/utility/playbackRate";
import { getEpisodeKey } from "src/utility/episodeKey";
import {
	getPlayedEpisode,
	getPlayedEpisodeAliasKeys,
} from "src/utility/episodeStatus";

// `src/store` is the single import surface for the store layer. The feed/cache/
// Latest-Episodes projection and the offline downloads store are self-contained
// leaf modules; re-export them here so consumers keep importing from one place.
export {
	podcastsUpdated,
	savedFeeds,
	episodeCache,
	episodeListLimit,
	sanitizeEpisodeListLimit,
	latestEpisodes,
} from "./feeds";
export { downloadedEpisodes } from "./downloads";

export const plugin = writable<PodNotes>();
export const currentTime = writable<number>(0);
export const requestedPlaybackTime = writable<{
	episodeKey: string;
	time: number;
	endTime?: number;
} | null>(null);
export const activePlaybackSegment = writable<PlaybackSegment | null>(null);
export const duration = writable<number>(0);
export const playbackRate = writable<number>(DEFAULT_PLAYBACK_RATE);
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

function getEpisodeFilePath(episode: Episode): string | undefined {
	return (episode as Partial<DownloadedEpisode>).filePath;
}

function sameEpisodeProjection(a: Episode[], b: Episode[]): boolean {
	if (a.length !== b.length) return false;

	const episodesInA = new Map(
		a.map((episode) => [getEpisodeKey(episode), episode]),
	);
	for (const episode of b) {
		const key = getEpisodeKey(episode);
		const existing = key ? episodesInA.get(key) : undefined;
		if (!existing) return false;
		if (existing.streamUrl !== episode.streamUrl) return false;
		if (existing.mediaType !== episode.mediaType) return false;
		if (getEpisodeFilePath(existing) !== getEpisodeFilePath(episode)) {
			return false;
		}
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
			// every object value as changed), re-running the localFiles persistence
			// binding + saveSettings on every unrelated downloadedEpisodes mutation and
			// the load-time immediate-fire. Comparing before touching the store avoids that.
			if (sameEpisodeProjection(get(store).episodes, episodes)) {
				return;
			}

			update((playlist) => ({ ...playlist, ...LOCAL_FILES_SETTINGS, episodes }));
		},
		getLocalEpisode: (title: string): LocalEpisode | undefined => {
			const { episodes } = get(store);

			// Match case- and whitespace-insensitively so a deep link resolves the
			// same way the normalized feed path does (LF-08). Still prefer a genuine
			// manual local file so a same-titled downloaded episode (now mirrored
			// into this playlist) can't shadow it.
			const target = title.trim().toLowerCase();
			const matches = (episode: Episode) =>
				episode.title.trim().toLowerCase() === target;
			const ep =
				episodes.find(
					(episode) => matches(episode) && episode.podcastName === "local file",
				) ?? episodes.find(matches);

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

/**
 * Drops the current episode from the queue whenever it changes — an episode you
 * are now playing should not also sit in the up-next queue. Subscribes to
 * currentEpisode and returns an unsubscriber for lifecycle cleanup.
 *
 * This is queue automation, not persistence: it formerly lived inside
 * QueueController, which conflated the two. Unlike auto-population/advance it is
 * intentionally NOT gated on autoQueueEnabled — a manually started episode is
 * removed from the queue regardless of the automation toggle.
 */
export function subscribeQueueToCurrentEpisode(): Unsubscriber {
	return currentEpisode.subscribe((episode) => {
		if (!episode) return;

		const { episodes } = get(queue);
		const episodeIsInQueue = episodes.some((e) => e.title === episode.title);
		if (!episodeIsInQueue) return;

		queue.update((playlist) => {
			playlist.episodes = playlist.episodes.filter(
				(e) => e.title !== episode.title,
			);
			return playlist;
		});
	});
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
