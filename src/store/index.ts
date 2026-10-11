import { get, writable } from "svelte/store";
import type PodNotes from "src/main";
import type { Episode } from "src/types/Episode";
import type { PlayedEpisode } from "src/types/PlayedEpisode";
import type { Playlist } from "src/types/Playlist";
import { ViewState } from "src/types/ViewState";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import { LOCAL_FILES_SETTINGS } from "src/constants";
import { getEpisodeKey, isSameEpisode } from "src/utility/episodeKey";
import { getPlayedEpisode, getPlayedEpisodeAliasKeys } from "src/utility/episodeStatus";

// `src/store` is the single import surface for the store layer. The feed/cache/
// Latest-Episodes projection and the offline downloads store are self-contained
// leaf modules; re-export them here so consumers keep importing from one place.
export {
	savedFeeds,
	episodeCache,
	episodeListLimit,
	sanitizeEpisodeListLimit,
	latestEpisodes,
} from "./feeds";
export { downloadedEpisodes } from "./downloads";

export const plugin = writable<PodNotes>();
export const hidePlayedEpisodes = writable<boolean>(false);

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
	const aliasKeys = getPlayedEpisodeAliasKeys(playedEpisodeMap, episode, preferredKey);
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
export function reorderEpisodes(episodes: Episode[], from: number, to: number): Episode[] {
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
 * Returns the episodes with later duplicate episode keys removed, preserving
 * order and the first occurrence. This keeps the queue unique regardless of how
 * it was populated, including queues persisted or synced before dedup-on-add
 * existed.
 */
export function dedupeEpisodesByKey(episodes: Episode[] = []): Episode[] {
	const seen = new Set<string>();
	const result: Episode[] = [];

	for (const episode of episodes) {
		const key = getEpisodeKey(episode);
		if (seen.has(key)) continue;

		seen.add(key);
		result.push(episode);
	}

	return result;
}

export type QueueMove = "top" | "up" | "down" | "bottom";

export const queue = (() => {
	const store = writable<Playlist>({
		icon: "list-ordered",
		name: "Queue",
		episodes: [],
		shouldEpisodeRemoveAfterPlay: true,
		shouldRepeat: false,
	});
	const { subscribe, update, set: setStore } = store;

	// The queue identifies episodes by getEpisodeKey everywhere (remove,
	// played-cleanup, context menu, reorder). Keeping it unique on add makes those
	// lookups unambiguous.
	const isAlreadyQueued = (episodes: Episode[], episode: Episode) =>
		episodes.some((e) => isSameEpisode(e, episode));

	return {
		subscribe,
		update,
		// Enforce the unique invariant on every set (load, import, sync), not just
		// on incremental adds.
		set: (playlist: Playlist) =>
			setStore({
				...playlist,
				episodes: dedupeEpisodesByKey(playlist.episodes),
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
				queue.episodes = queue.episodes.filter((e) => !isSameEpisode(e, episode));
				return queue;
			});
		},
		/** Puts the episode first, unless it is already queued. */
		prepend: (episode: Episode) => {
			update((queue) => {
				if (isAlreadyQueued(queue.episodes, episode)) return queue;

				queue.episodes = [episode, ...queue.episodes];
				return queue;
			});
		},
		/** Finds the episode when the move applies, so a queue that changed since cannot move another. */
		move: (episode: Episode, to: QueueMove) => {
			const { episodes } = get(store);
			const from = episodes.findIndex((e) => isSameEpisode(e, episode));
			const target = { top: 0, up: from - 1, down: from + 1, bottom: episodes.length - 1 }[
				to
			];
			const reordered = reorderEpisodes(episodes, from, target);

			// No-op move: skip the store write so we don't churn saveSettings.
			if (reordered === episodes) return;

			update((queue) => {
				queue.episodes = reordered;
				return queue;
			});
		},
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

	const episodesInA = new Map(a.map((episode) => [getEpisodeKey(episode), episode]));
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
		 * downloads (downloadEpisodeToDisk) and manual local files (getContextMenuHandler)
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
		syncWithDownloaded: (downloaded: { [podcastName: string]: DownloadedEpisode[] }): void => {
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
			const matches = (episode: Episode) => episode.title.trim().toLowerCase() === target;
			const ep =
				episodes.find(
					(episode) => matches(episode) && episode.podcastName === "local file",
				) ?? episodes.find(matches);

			return ep as LocalEpisode | undefined;
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
