import { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { Playlist } from "./types/Playlist";

export const VIEW_TYPE = "podcast_player_view";

type PlaylistSettings = Pick<Playlist, "icon" | "name" | "shouldEpisodeRemoveAfterPlay" | "shouldRepeat">;

export const FAVORITES_SETTINGS: PlaylistSettings = {
	icon: "lucide-star",
	name: "Favorites",
	shouldEpisodeRemoveAfterPlay: false,
	shouldRepeat: false,
}

export const QUEUE_SETTINGS: PlaylistSettings = {
	icon: "list-ordered",
	name: "Queue",
	shouldEpisodeRemoveAfterPlay: true,
	shouldRepeat: false,
}

export const LOCAL_FILES_SETTINGS: PlaylistSettings = {
	icon: "folder",
	name: "Local Files",
	shouldEpisodeRemoveAfterPlay: false,
	shouldRepeat: false,
}

export const DEFAULT_SETTINGS: IPodNotesSettings = {
	savedFeeds: {},
	podNotes: {},
	defaultPlaybackRate: 1,
	playedEpisodes: {},
	favorites: {
		...FAVORITES_SETTINGS,
		episodes: [],
	},
	queue: {
		...QUEUE_SETTINGS,
		episodes: [],
	},
	playlists: {},
	skipBackwardLength: 15,
	skipForwardLength: 15,
	currentEpisode: undefined,

	timestamp: {
		template: "- {{time}} ",
	},

	note: {
		path: "",
		template: "",
	},

	download: {
		path: "",
	},
	downloadedEpisodes: {},
	localFiles: {
		...LOCAL_FILES_SETTINGS,
		episodes: [],
	}
}

