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

	const unsubscribe = episodeCache.subscribe((cache) => {
		const cacheEntries = Object.entries(cache);
		const feedCount = cacheEntries.length;
		const latestLimit = Math.max(
			1,
			LATEST_EPISODES_PER_FEED * Math.max(feedCount, 1),
		);

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
					: getLatestEpisodesForFeed(episodes);

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
	});

	return () => {
		latestByFeed.clear();
		feedSources.clear();
		mergedLatest = [];
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
