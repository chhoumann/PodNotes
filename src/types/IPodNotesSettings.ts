import { PodNotes } from './PodNotes';
import { PodcastFeeds } from "./PodcastFeed";

export interface IPodNotesSettings {
	savedFeeds: PodcastFeeds
	podNotes: PodNotes;
}
