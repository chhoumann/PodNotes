import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { Playlist } from "./types/Playlist";
import { DEFAULT_SPEAKER_TEMPLATE } from "./services/diarization/segments";

export const VIEW_TYPE = "podcast_player_view";

/**
 * How many of each feed's most recent episodes are surfaced in the aggregated
 * "Latest Episodes" list (and therefore searchable from it). The default of 10
 * preserves the historical behaviour; users who want to search further back
 * through each feed can raise it (issue #114).
 */
export const DEFAULT_EPISODE_LIST_LIMIT = 10;

/**
 * Upper bound for {@link DEFAULT_EPISODE_LIST_LIMIT}. Kept in lockstep with the
 * feed cache's `MAX_EPISODES_PER_FEED` (see src/services/FeedCacheService.ts):
 * on a warm start the Latest Episodes list is rebuilt from the persisted cache,
 * which retains at most that many episodes per feed, so a limit larger than the
 * cap could never actually be served. Selecting an individual podcast still
 * shows that feed's full episode list, unbounded by this setting.
 */
export const MAX_EPISODE_LIST_LIMIT = 75;

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
	episodeListLimit: DEFAULT_EPISODE_LIST_LIMIT,
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
		// Group episode notes under a per-podcast folder, matching the download
		// path convention (PodNotes/{{podcast}}/{{title}}). See issue #160.
		path: "PodNotes/{{podcast}}/{{title}}.md",
		// Bases-friendly frontmatter so new installs get queryable episode metadata
		// out of the box (issue #160). Every value here is guaranteed valid YAML
		// because none of them can contain a YAML-hostile character: {{podcastlink}}
		// is a wikilink whose name is sanitized (no quotes) and is quoted so its
		// leading "[[" can't be read as a flow sequence, and {{date:YYYY-MM-DD}} is
		// either an ISO date or empty (null). status/rating/favorite are left for the
		// user to fill and give Bases columns to sort and filter on. The raw
		// {{title}} (which may contain quotes/colons) and {{url}} (a feed URL, or for
		// a local file a vault link whose name may contain a quote) live in the BODY,
		// where YAML rules don't apply — keeping the verbatim, unescaped tag values
		// out of quoted frontmatter scalars so the frontmatter never fails to parse
		// (issue #160 review). {{podcastlink}} ties each episode to its feed note
		// (#163). See issue #160.
		template:
			"---\n" +
			"type: podcastEpisode\n" +
			'podcast: "{{podcastlink}}"\n' +
			"date: {{date:YYYY-MM-DD}}\n" +
			"tags:\n" +
			"  - podcastEpisode\n" +
			"status:\n" +
			"rating:\n" +
			"favorite: false\n" +
			"---\n" +
			"# {{title}}\n\n" +
			"![]({{artwork}})\n\n" +
			"[Resume in PodNotes]({{episodelink}})\n\n" +
			"{{url}}\n\n" +
			"{{description}}\n",
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
	openAISecretId: "",
	deepgramSecretId: "",
	transcript: {
		path: "transcripts/{{podcast}}/{{title}}.md",
		template: "# {{title}}\n\nPodcast: {{podcast}}\nDate: {{date}}\n\n{{transcript}}",
		// Diarization is off by default so existing behaviour (plain Whisper) is
		// unchanged; enabling it routes audio to the chosen provider (#168).
		diarization: {
			enabled: false,
			provider: "openai",
			speakerTemplate: DEFAULT_SPEAKER_TEMPLATE,
		},
	},
	feedCache: {
		enabled: true,
		ttlHours: 6,
	},
};
