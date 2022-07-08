import { writable } from 'svelte/store';
import type PodNotes from 'src/main';
import { Episode } from 'src/types/Episode';
import { PlayedEpisode } from 'src/types/playedEpisode';
import { PodcastFeed } from 'src/types/PodcastFeed';

export const plugin = writable<PodNotes>();
export const currentTime = writable<number>(0);
export const duration = writable<number>(0);
export const currentEpisode = writable<Episode>();
export const isPaused = writable<boolean>(true);
export const playedEpisodes = writable<{
    [key: string]: PlayedEpisode;
}>({});
export const savedFeeds = writable<{[podcastName: string]: PodcastFeed}>({});