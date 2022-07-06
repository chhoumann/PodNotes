import { PodNote } from './PodNotes';
import { PodcastFeed } from "./PodcastFeed";

export interface IPodNotesSettings {
	savedFeeds: { [podcastName: string]: PodcastFeed };
	podNotes: { [episodeName: string]: PodNote }
	defaultPlaybackRate: number;
}
