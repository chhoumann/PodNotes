import { PodNote } from './PodNotes';
import { PodcastFeed } from "./PodcastFeed";
import { PlayedEpisode } from './playedEpisode';

export interface IPodNotesSettings {
	savedFeeds: { [podcastName: string]: PodcastFeed };
	podNotes: { [episodeName: string]: PodNote }
	defaultPlaybackRate: number;
	playedEpisodes: { [episodeName: string]: PlayedEpisode }
}
