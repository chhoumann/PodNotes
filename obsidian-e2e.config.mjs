// Consumer config for the shared obsidian-e2e instance runner. The four
// `provision:e2e-vault` / `start:e2e-obsidian` / `stop:e2e-obsidian` /
// `obsidian:e2e` scripts point at the `obsidian-e2e` bin, which reads this file
// from the worktree root. See the runner's README ("Instance Runner (CLI)") for
// the full schema.
//
// `defaultData` seeds a freshly provisioned vault's data.json. It mirrors
// DEFAULT_SETTINGS in src/constants.ts (plus the `schemaVersion: 2` persistence
// marker PodNotes writes alongside its settings) so a new vault loads with clean
// PodNotes state and the current on-disk schema. `currentEpisode` is omitted:
// DEFAULT_SETTINGS sets it to `undefined`, which JSON cannot represent and
// PodNotes treats as absent. Keep this in sync with constants.ts -
// scripts/e2e-config.test.ts fails if it drifts from DEFAULT_SETTINGS.
export default {
	pluginId: "podnotes",
	// PodNotes injects its CSS into main.js (svelte compilerOptions css:
	// "injected"), so there is no styles.css artifact - only the manifest and the
	// compiled bundle are symlinked into the vault.
	pluginArtifacts: ["manifest.json", "main.js"],
	defaultData: {
		schemaVersion: 2,
		savedFeeds: {},
		podNotes: {},
		defaultPlaybackRate: 1,
		defaultVolume: 1,
		hidePlayedEpisodes: false,
		episodeListLimit: 10,
		playedEpisodes: {},
		favorites: {
			icon: "lucide-star",
			name: "Favorites",
			shouldEpisodeRemoveAfterPlay: false,
			shouldRepeat: false,
			episodes: [],
		},
		queue: {
			icon: "list-ordered",
			name: "Queue",
			shouldEpisodeRemoveAfterPlay: true,
			shouldRepeat: false,
			episodes: [],
		},
		autoQueue: true,
		playlists: {},
		skipBackwardLength: 15,
		skipForwardLength: 15,
		timestamp: {
			template: "- {{time}} ",
			offset: 0,
		},
		note: {
			path: "PodNotes/{{podcast}}/{{title}}.md",
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
			path: "PodNotes/{{podcast}}/{{title}}",
		},
		downloadedEpisodes: {},
		localFiles: {
			icon: "folder",
			name: "Local Files",
			shouldEpisodeRemoveAfterPlay: false,
			shouldRepeat: false,
			episodes: [],
		},
		openAISecretId: "",
		deepgramSecretId: "",
		transcript: {
			path: "transcripts/{{podcast}}/{{title}}.md",
			template: "# {{title}}\n\nPodcast: {{podcast}}\nDate: {{date}}\n\n{{transcript}}",
			diarization: {
				enabled: false,
				provider: "openai",
				speakerTemplate: "**{{speaker}}:** ",
			},
		},
		feedCache: {
			enabled: true,
			ttlHours: 6,
		},
	},
	buildCommand: "npm run build",
	// Emit legacy PODNOTES_E2E_* env aliases alongside the canonical OBSIDIAN_E2E_*
	// names while the harness and AGENTS.md playbooks migrate off them.
	envPrefix: "PODNOTES",
	// Confirm the PodNotes plugin instance is live in the target vault. The launcher
	// waits for stdout to contain the match string; the code intentionally omits the
	// literal "=> true" so an echoed command can't be mistaken for a positive result.
	readyProbe: {
		kind: "eval",
		code: `Boolean(app.plugins.plugins["podnotes"])`,
		match: "=> true",
	},
};
