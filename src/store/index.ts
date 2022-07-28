import { get, writable } from 'svelte/store';
import type PodNotes from 'src/main';
import { Episode } from 'src/types/Episode';
import { PlayedEpisode } from 'src/types/PlayedEpisode';
import { PodcastFeed } from 'src/types/PodcastFeed';
import { Playlist } from 'src/types/Playlist';
import { ViewState } from 'src/types/ViewState';

export const plugin = writable<PodNotes>();
export const currentTime = writable<number>(0);
export const duration = writable<number>(0);

export const currentEpisode = function () {
	const store = writable<Episode>();
	const { subscribe, update } = store;

	return {
		subscribe,
		set: (newEpisode: Episode) => {
			update(previousEpisode => {
				if (previousEpisode) {
					addEpisodeToQueue(previousEpisode);
				}

				return newEpisode;
			});
		}
	}
}();


export const isPaused = writable<boolean>(true);
export const playedEpisodes = function () {
	const store = writable<{ [key: string]: PlayedEpisode }>({});
	const { subscribe, update, set } = store;

	return {
		subscribe,
		set,
		update,
		add: (episode: Episode, time: number, duration: number, finished: boolean) => {
			update(playedEpisodes => {
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
			update(playedEpisodes => {
				const playedEpisode = playedEpisodes[episode.title];

				if (playedEpisode) {
					playedEpisode.finished = true;
				}

				playedEpisodes[episode.title] = playedEpisode;
				return playedEpisodes;
			});
		}
	}
}();

export const savedFeeds = writable<{ [podcastName: string]: PodcastFeed }>({});

export const episodeCache = writable<{ [podcastName: string]: Episode[] }>({});

export const queue = function () {
	const store = writable<Playlist>({
		icon: 'list-ordered',
		name: 'Queue',
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
			update(queue => {
				queue.episodes.push(episode);
				return queue;
			});
		},
		remove: (episode: Episode) => {
			update(queue => {
				queue.episodes = queue.episodes.filter(e => e.title !== episode.title);
				return queue;
			});
		},
		playNext: () => {
			update(queue => {
				const nextEp = queue.episodes.shift();

				if (nextEp) {
					currentEpisode.set(nextEp);
				}

				return queue;
			});
		}
	}
}();

export const favorites = writable<Playlist>({
	icon: 'lucide-star',
	name: 'Favorites',
	episodes: [],
	shouldEpisodeRemoveAfterPlay: false,
	shouldRepeat: false,
});

export const playlists = writable<{ [name: string]: Playlist }>({});

export const podcastView = writable<HTMLDivElement>();
export const viewState = function () {
	const store = writable<ViewState>(ViewState.PodcastGrid);
	const { subscribe, set } = store;

	return {
		subscribe,
		set: (newState: ViewState) => {
			set(newState);
			
			get(podcastView)?.scrollIntoView();
		}
	}
 }();

function addEpisodeToQueue(episode: Episode) {
	queue.update(playlist => {
		const newEpisodes = [episode, ...playlist.episodes];
		playlist.episodes = newEpisodes;

		return playlist;
	});
}
