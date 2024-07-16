import { PodNote } from './PodNotes';
import { PodcastFeed } from "./PodcastFeed";
import { PlayedEpisode } from './PlayedEpisode';
import { Playlist } from './Playlist';
import { Episode } from './Episode';
import DownloadedEpisode from './DownloadedEpisode';

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
	localFiles: Playlist,
	currentEpisode?: Episode,

	timestamp: {
		template: string;
	},

	note: {
		path: string;
		template: string;
	},

	download: {
		path: string,
	}
	downloadedEpisodes: { [podcastName: string]: DownloadedEpisode[] },
	openAIApiKey: string,
	transcript: {
		path: string;
		template: string;
	}
}