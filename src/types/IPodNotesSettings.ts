import { PodNote } from './PodNotes';
import { PodcastFeed } from "./PodcastFeed";
import { PlayedEpisode } from './PlayedEpisode';
import { Playlist } from './Playlist';
import { Episode } from './Episode';

export interface IPodNotesSettings {
	savedFeeds: { [podcastName: string]: PodcastFeed };
	podNotes: { [episodeName: string]: PodNote }
	defaultPlaybackRate: number;
	playedEpisodes: { [episodeName: string]: PlayedEpisode }
	skipBackwardLength: number;
	skipForwardLength: number;
	playlists: { [playlistName: string]: Playlist }
	queue: Playlist,
	favorites: Playlist,
	currentEpisode: Episode,
}
