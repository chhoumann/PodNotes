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

export const plugin = writable<PodNotes>();
export const currentTime = writable<number>(0);
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
					const isFinished = ct === dur;
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
		setEpisodeTime: (
			episode: Episode,
			time: number,
			duration: number,
			finished: boolean,
		) => {
			update((playedEpisodes) => {
				playedEpisodes[episode.title] = {
					title: episode.title,
					podcastName: episode.podcastName,
					time,
					duration,
					finished,
				};

				return playedEpisodes;
			});
		},
		markAsPlayed: (episode: Episode) => {
			update((playedEpisodes) => {
				const playedEpisode = playedEpisodes[episode.title] || episode;

				if (playedEpisode) {
					playedEpisode.time = playedEpisode.duration;
					playedEpisode.finished = true;
				}

				playedEpisodes[episode.title] = playedEpisode;
				return playedEpisodes;
			});
		},
		markAsUnplayed: (episode: Episode) => {
			update((playedEpisodes) => {
				const playedEpisode = playedEpisodes[episode.title] || episode;

				if (playedEpisode) {
					playedEpisode.time = 0;
					playedEpisode.finished = false;
				}

				playedEpisodes[episode.title] = playedEpisode;
				return playedEpisodes;
			});
		},
	};
})();

export const podcastsUpdated = writable(0);

export const savedFeeds = writable<{ [podcastName: string]: PodcastFeed }>({});

export const episodeCache = writable<{ [podcastName: string]: Episode[] }>({});

const LATEST_EPISODES_PER_FEED = 10;

type LatestEpisodesByFeed = Map<string, Episode[]>;
type FeedEpisodeSources = Map<string, Episode[]>;
type LatestEpisodePointer = {
	feedTitle: string;
	index: number;
	episode: Episode;
};

function getEpisodeTimestamp(episode?: Episode): number {
	if (!episode?.episodeDate) return 0;

	return Number(episode.episodeDate);
}

function getLatestEpisodesForFeed(episodes: Episode[]): Episode[] {
	if (!episodes?.length) return [];

	return episodes
		.slice(0, LATEST_EPISODES_PER_FEED)
		.sort((a, b) => getEpisodeTimestamp(b) - getEpisodeTimestamp(a));
}

function shallowEqualEpisodes(a?: Episode[], b?: Episode[]): boolean {
	if (!a || !b || a.length !== b.length) return false;

	for (let i = 0; i < a.length; i += 1) {
		if (a[i] !== b[i]) return false;
	}

	return true;
}

function pushEpisodePointer(
	heap: LatestEpisodePointer[],
	pointer: LatestEpisodePointer,
): void {
	heap.push(pointer);
	let idx = heap.length - 1;

	while (idx > 0) {
		const parent = Math.floor((idx - 1) / 2);
		if (
			getEpisodeTimestamp(heap[parent].episode) >=
			getEpisodeTimestamp(heap[idx].episode)
		) {
			break;
		}

		heap[idx] = heap[parent];
		heap[parent] = pointer;
		idx = parent;
	}
}

function popEpisodePointer(
	heap: LatestEpisodePointer[],
): LatestEpisodePointer | undefined {
	if (heap.length === 0) return undefined;

	const top = heap[0];
	const last = heap.pop();

	if (last && heap.length > 0) {
		heap[0] = last;
		let idx = 0;

		while (true) {
			const left = idx * 2 + 1;
			const right = idx * 2 + 2;
			let largest = idx;

			if (
				left < heap.length &&
				getEpisodeTimestamp(heap[left].episode) >
					getEpisodeTimestamp(heap[largest].episode)
			) {
				largest = left;
			}

			if (
				right < heap.length &&
				getEpisodeTimestamp(heap[right].episode) >
					getEpisodeTimestamp(heap[largest].episode)
			) {
				largest = right;
			}

			if (largest === idx) break;

			const temp = heap[idx];
			heap[idx] = heap[largest];
			heap[largest] = temp;
			idx = largest;
		}
	}

	return top;
}

// Use a max-heap to merge the latest episodes from each feed without
// resorting the entire cache every time a single feed updates.
function mergeLatestEpisodes(latestByFeed: LatestEpisodesByFeed): Episode[] {
	const heap: LatestEpisodePointer[] = [];

	for (const [feedTitle, episodes] of latestByFeed.entries()) {
		if (!episodes.length) continue;

		pushEpisodePointer(heap, {
			feedTitle,
			index: 0,
			episode: episodes[0],
		});
	}

	const merged: Episode[] = [];
	while (heap.length > 0) {
		const pointer = popEpisodePointer(heap);
		if (!pointer) break;

		merged.push(pointer.episode);

		const feedEpisodes = latestByFeed.get(pointer.feedTitle);
		const nextIndex = pointer.index + 1;
		if (feedEpisodes && nextIndex < feedEpisodes.length) {
			pushEpisodePointer(heap, {
				feedTitle: pointer.feedTitle,
				index: nextIndex,
				episode: feedEpisodes[nextIndex],
			});
		}
	}

	return merged;
}

export const latestEpisodes = readable<Episode[]>([], (set) => {
	let latestByFeed: LatestEpisodesByFeed = new Map();
	let feedSources: FeedEpisodeSources = new Map();

	const unsubscribe = episodeCache.subscribe((cache) => {
		let changed = false;
		const nextSources: FeedEpisodeSources = new Map();
		const nextLatestByFeed: LatestEpisodesByFeed = new Map();

		for (const [feedTitle, episodes] of Object.entries(cache)) {
			nextSources.set(feedTitle, episodes);
			const previousSource = feedSources.get(feedTitle);
			const previousLatest = latestByFeed.get(feedTitle);

			if (previousSource === episodes && previousLatest) {
				nextLatestByFeed.set(feedTitle, previousLatest);
				continue;
			}

			const latestForFeed = getLatestEpisodesForFeed(episodes);
			nextLatestByFeed.set(feedTitle, latestForFeed);

			if (!changed) {
				changed =
					!previousLatest ||
					!shallowEqualEpisodes(previousLatest, latestForFeed);
			}
		}

		if (!changed) {
			for (const feedTitle of feedSources.keys()) {
				if (!nextSources.has(feedTitle)) {
					changed = true;
					break;
				}
			}
		}

		feedSources = nextSources;

		if (!changed && nextLatestByFeed.size === latestByFeed.size) {
			latestByFeed = nextLatestByFeed;
			return;
		}

		latestByFeed = nextLatestByFeed;
		set(mergeLatestEpisodes(latestByFeed));
	});

	return () => {
		latestByFeed.clear();
		feedSources.clear();
		unsubscribe();
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
				const filePath = podcastEpisodes[index].filePath;

				podcastEpisodes.splice(index, 1);

				if (removeFile) {
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

export const queue = (() => {
	const store = writable<Playlist>({
		icon: "list-ordered",
		name: "Queue",
		episodes: [],
		shouldEpisodeRemoveAfterPlay: true,
		shouldRepeat: false,
	});
	const { subscribe, update, set } = store;

	return {
		subscribe,
		update,
		set,
		add: (episode: Episode) => {
			update((queue) => {
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
			update((queue) => {
				const nextEp = queue.episodes.shift();

				if (nextEp) {
					currentEpisode.set(nextEp, false);
				}

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
		getLocalEpisode: (title: string): LocalEpisode | undefined => {
			const ep = get(store).episodes.find((ep) => ep.title === title);

			return ep as LocalEpisode;
		},
		updateStreamUrl: (title: string, newUrl: string): void => {
			store.update((playlist) => {
				const idx = playlist.episodes.findIndex((ep) => ep.title === title);

				if (idx !== -1) playlist.episodes[idx].streamUrl = newUrl;

				return playlist;
			});
		},
		addEpisode: (episode: LocalEpisode): void => {
			store.update((playlist) => {
				const idx = playlist.episodes.findIndex(
					(ep) => ep.title === episode.title,
				);

				if (idx !== -1) {
					playlist.episodes[idx] = episode;
				} else {
					playlist.episodes.push(episode);
				}

				return playlist;
			});
		},
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

function addEpisodeToQueue(episode: Episode) {
	queue.update((playlist) => {
		const newEpisodes = [episode, ...playlist.episodes];
		playlist.episodes = newEpisodes;

		return playlist;
	});
}
