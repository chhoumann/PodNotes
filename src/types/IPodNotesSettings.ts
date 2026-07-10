import type { PodNote } from "./PodNotes";
import type { PodcastFeed } from "./PodcastFeed";
import type { PlayedEpisode } from "./PlayedEpisode";
import type { Playlist } from "./Playlist";
import type { Episode } from "./Episode";
import type DownloadedEpisode from "./DownloadedEpisode";
import type { DiarizationProviderId } from "src/services/diarization/types";

export interface IPodNotesSettings {
	savedFeeds: { [podcastName: string]: PodcastFeed };
	podNotes: { [episodeName: string]: PodNote };
	defaultPlaybackRate: number;
	defaultVolume: number;
	hidePlayedEpisodes: boolean;
	/**
	 * How many of each saved feed's most recent episodes are surfaced in the
	 * aggregated "Latest Episodes" list (and searchable from it). Defaults to 10;
	 * raise it to look further back through each feed's history (issue #114).
	 */
	episodeListLimit: number;
	playedEpisodes: { [episodeName: string]: PlayedEpisode };
	skipBackwardLength: number;
	skipForwardLength: number;
	playlists: { [playlistName: string]: Playlist };
	queue: Playlist;
	/**
	 * Queue automation (issue #108). When `true` (default) switching episodes
	 * keeps the one you left at the top of the queue and playback auto-advances to
	 * the next queued episode. When `false` the queue stops filling and advancing
	 * on its own; it remains usable as a manual playlist.
	 */
	autoQueue: boolean;
	favorites: Playlist;
	localFiles: Playlist;
	currentEpisode?: Episode;

	timestamp: {
		template: string;
		offset: number;
	};

	note: {
		path: string;
		template: string;
	};

	feedNote: {
		path: string;
		template: string;
	};

	download: {
		path: string;
	};
	downloadedEpisodes: { [podcastName: string]: DownloadedEpisode[] };
	/** SecretStorage ID for the OpenAI API key. Never contains the key itself. */
	openAISecretId: string;
	/** SecretStorage ID for the Deepgram API key. Never contains the key itself. */
	deepgramSecretId: string;
	transcript: {
		path: string;
		template: string;
		/**
		 * Opt-in speaker diarization for transcripts (issue #168). When `enabled`
		 * the audio is routed to a diarization-capable `provider` instead of plain
		 * Whisper, and the transcript is rendered as speaker-labeled turns using
		 * `speakerTemplate` (where `{{speaker}}` is the per-turn speaker label).
		 */
		diarization: {
			enabled: boolean;
			provider: DiarizationProviderId;
			speakerTemplate: string;
		};
	};
	feedCache: {
		enabled: boolean;
		ttlHours: number;
	};
}
