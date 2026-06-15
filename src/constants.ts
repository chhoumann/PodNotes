import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { Playlist } from "./types/Playlist";

export const VIEW_TYPE = "podcast_player_view";

type PlaylistSettings = Pick<
	Playlist,
	"icon" | "name" | "shouldEpisodeRemoveAfterPlay" | "shouldRepeat"
>;

export const FAVORITES_SETTINGS: PlaylistSettings = {
	icon: "lucide-star",
	name: "Favorites",
	shouldEpisodeRemoveAfterPlay: false,
	shouldRepeat: false,
};

export const QUEUE_SETTINGS: PlaylistSettings = {
	icon: "list-ordered",
	name: "Queue",
	shouldEpisodeRemoveAfterPlay: true,
	shouldRepeat: false,
};

export const LOCAL_FILES_SETTINGS: PlaylistSettings = {
	icon: "folder",
	name: "Local Files",
	shouldEpisodeRemoveAfterPlay: false,
	shouldRepeat: false,
};

export const PLAYED_SETTINGS: PlaylistSettings = {
	icon: "check-square",
	name: "Played",
	shouldEpisodeRemoveAfterPlay: false,
	shouldRepeat: false,
};

export const DEFAULT_SETTINGS: IPodNotesSettings = {
	savedFeeds: {},
	podNotes: {},
	defaultPlaybackRate: 1,
	defaultVolume: 1,
	hidePlayedEpisodes: false,
	playedEpisodes: {},
	favorites: {
		...FAVORITES_SETTINGS,
		episodes: [],
	},
	queue: {
		...QUEUE_SETTINGS,
		episodes: [],
	},
	autoQueue: true,
	playlists: {},
	skipBackwardLength: 15,
	skipForwardLength: 15,
	currentEpisode: undefined,

	timestamp: {
		template: "- {{time}} ",
		offset: 0,
	},

	note: {
		path: "",
		template: "",
	},

	feedNote: {
		path: "PodNotes/Podcasts/{{podcast}}.md",
		// Bases-friendly frontmatter. Only YAML-safe values go in the frontmatter:
		// {{podcast}} is sanitized (quotes/colons stripped) and the quoted URL
		// scalars ({{artwork}}/{{url}}/{{feedurl}}) have their quote/backslash
		// stripped by the feed engine, so an arbitrary or empty value always
		// produces valid YAML. The raw {{title}}/{{author}} (which may contain
		// quotes/colons) live in the note body instead, where YAML rules don't
		// apply. See issue #163 / #160.
		template:
			"---\n" +
			"type: podcast\n" +
			'podcast: "{{podcast}}"\n' +
			'image: "{{artwork}}"\n' +
			'url: "{{url}}"\n' +
			'feedUrl: "{{feedurl}}"\n' +
			"tags:\n" +
			"  - podcast\n" +
			"---\n" +
			"# {{title}}\n" +
			"{{author}}\n\n" +
			"![]({{artwork}})\n\n" +
			"{{description}}\n",
	},

	download: {
		// Must include a per-episode token ({{title}}). An empty or token-less path
		// resolves every episode to the same name — e.g. "" -> ".mp3", a hidden
		// dotfile at the vault root that Obsidian never indexes — so the first
		// download writes junk and the second throws "File already exists" (#183).
		path: "PodNotes/{{podcast}}/{{title}}",
	},
	downloadedEpisodes: {},
	localFiles: {
		...LOCAL_FILES_SETTINGS,
		episodes: [],
	},
	openAIApiKey: "",
	transcript: {
		path: "transcripts/{{podcast}}/{{title}}.md",
		template:
			"# {{title}}\n\nPodcast: {{podcast}}\nDate: {{date}}\n\n{{transcript}}",
	},
	feedCache: {
		enabled: true,
		ttlHours: 6,
	},
};
