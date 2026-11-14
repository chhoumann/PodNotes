import type { PodNote } from "./PodNotes";
import type { PodcastFeed } from "./PodcastFeed";
import type { PlayedEpisode } from "./PlayedEpisode";
import type { Playlist } from "./Playlist";
import type { Episode } from "./Episode";
import type DownloadedEpisode from "./DownloadedEpisode";
import type { NextTrackAction, PreviousTrackAction } from "./Headset";
import type { CredentialReferenceSettings } from "./Credentials";

export interface IPodNotesSettings extends CredentialReferenceSettings {
	savedFeeds: { [podcastName: string]: PodcastFeed };
	podNotes: { [episodeName: string]: PodNote };
	defaultPlaybackRate: number;
	/** The player's volume as it was last set, which a new player starts at. */
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
	headsetPreviousTrack: PreviousTrackAction;
	headsetNextTrack: NextTrackAction;
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
		/** The id of the QuickAdd choice a capture runs instead of writing the timestamp itself. */
		quickAddChoiceId?: string;
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
	transcript: {
		path: string;
		template: string;
		/** The ID of the provider that transcribes audio. One this version does not have is kept as stored. */
		provider: string;
		/**
		 * The ID of one of the provider's models, or "" to follow the model PodNotes recommends.
		 * For an OpenAI-compatible server, the ID the user typed, which it must have.
		 */
		model: string;
		/** The address the user entered for an OpenAI-compatible server, as typed. */
		serverUrl: string;
		/**
		 * `enabled` asks for speaker labels, which the chosen model may not have.
		 * `speakerTemplate` shapes each label, where `{{speaker}}` is the speaker's name.
		 *
		 * Versions up to 2.24.0 kept their provider here, as `provider`. It fills
		 * `transcript.provider` in a library that has none, and stays in data.json as found
		 * for the devices that still run those versions.
		 */
		diarization: {
			enabled: boolean;
			speakerTemplate: string;
		};
	};
}
