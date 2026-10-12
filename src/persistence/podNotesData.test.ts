import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import type DownloadedEpisode from "src/types/DownloadedEpisode";
import type { Episode } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { Playlist } from "src/types/Playlist";
import {
	decodePodNotesData,
	encodePodNotesData,
	PODNOTES_DATA_SCHEMA_VERSION,
	PodNotesDataError,
} from "./podNotesData";

const episodeDate = new Date("2024-03-01T10:05:03.000Z");

function episode(title: string): Episode {
	return {
		title,
		streamUrl: `https://example.com/${title}.mp3`,
		url: `https://example.com/${title}`,
		description: `${title} description`,
		content: `${title} content`,
		podcastName: "Test Podcast",
		episodeDate,
	};
}

function playlist(name: string, item: Episode): Playlist {
	return {
		name,
		icon: "list",
		episodes: [item],
		currentEpisode: item,
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
	};
}

function settingsWithEveryEpisodeContainer(): IPodNotesSettings {
	const current = episode("Current");
	const queued = episode("Queued");
	const favorite = episode("Favorite");
	const local = { ...episode("Local"), filePath: "Podcasts/local.mp3" };
	const custom = episode("Custom");
	const downloaded = {
		...episode("Downloaded"),
		filePath: "Podcasts/downloaded.mp3",
		size: 42,
	} satisfies DownloadedEpisode;

	return {
		...structuredClone(DEFAULT_SETTINGS),
		currentEpisode: current,
		queue: playlist("Queue", queued),
		favorites: playlist("Favorites", favorite),
		localFiles: playlist("Local Files", local),
		playlists: { Custom: playlist("Custom", custom) },
		downloadedEpisodes: { "Test Podcast": [downloaded] },
	};
}

describe("PodNotes data schema", () => {
	it("loads fresh data as independent deep-cloned defaults", () => {
		const first = decodePodNotesData(undefined);
		const second = decodePodNotesData(null);

		expect(first.sourceVersion).toBe(0);
		expect(first.warnings).toEqual([]);
		expect(first.settings).toEqual(DEFAULT_SETTINGS);
		first.settings.queue.episodes.push(episode("Mutation"));
		first.settings.savedFeeds.Modified = {
			title: "Modified",
			url: "https://example.com/feed.xml",
			artworkUrl: "",
		};

		expect(DEFAULT_SETTINGS.queue.episodes).toEqual([]);
		expect(DEFAULT_SETTINGS.savedFeeds).toEqual({});
		expect(second.settings.queue.episodes).toEqual([]);
	});

	it("gives each new install its own library id, sorting after earlier installs and every unmarked library", () => {
		vi.spyOn(crypto, "randomUUID")
			.mockReturnValueOnce("ffffffff-ffff-4fff-bfff-ffffffffffff")
			.mockReturnValue("00000000-0000-4000-8000-000000000000");
		vi.setSystemTime(new Date("2026-10-11T09:00:00.000Z"));
		const [earlier, sameInstant] = [decodePodNotesData(null), decodePodNotesData(undefined)];
		vi.setSystemTime(new Date("2026-10-11T10:00:00.000Z"));
		const later = decodePodNotesData(null);
		vi.useRealTimers();
		vi.restoreAllMocks();
		const [earlierId, sameInstantId, laterId] = [earlier, sameInstant, later].map(
			({ unknownFields }) => unknownFields.libraryId,
		);

		expect([earlierId, sameInstantId, laterId]).toEqual(Array(3).fill(expect.any(String)));
		expect(sameInstantId).not.toBe(earlierId);
		expect(["", earlierId, laterId].sort()).toEqual(["", earlierId, laterId]);
		expect(encodePodNotesData(later.settings, later.unknownFields).libraryId).toBe(laterId);
	});

	it.each([
		["names none", undefined, ""],
		["names one that is not text", 7, ""],
		["names one", "2026-10-11T09:00:00.000Z 0b9d", "2026-10-11T09:00:00.000Z 0b9d"],
	])(
		"keeps the library id of a file that %s for the save to write back",
		(_, libraryId, kept) => {
			const file = JSON.parse(
				JSON.stringify({ ...encodePodNotesData(DEFAULT_SETTINGS), libraryId }),
			);
			const decoded = decodePodNotesData(file);

			expect(encodePodNotesData(decoded.settings, decoded.unknownFields).libraryId).toBe(
				kept,
			);
		},
	);

	it("round-trips every persisted episode container with canonical dates", () => {
		const settings = settingsWithEveryEpisodeContainer();
		const persisted = encodePodNotesData(settings);
		const json = JSON.parse(JSON.stringify(persisted)) as Record<string, unknown>;
		const decoded = decodePodNotesData(json);

		expect(persisted.schemaVersion).toBe(PODNOTES_DATA_SCHEMA_VERSION);
		expect((persisted.currentEpisode as Record<string, unknown>).episodeDate).toBe(
			episodeDate.toISOString(),
		);
		expect(decoded.sourceVersion).toBe(2);
		expect(decoded.changed).toBe(false);
		expect(decoded.settings.currentEpisode?.episodeDate).toEqual(episodeDate);
		expect(decoded.settings.queue.episodes[0].episodeDate).toEqual(episodeDate);
		expect(decoded.settings.queue.currentEpisode?.episodeDate).toEqual(episodeDate);
		expect(decoded.settings.favorites.episodes[0].episodeDate).toEqual(episodeDate);
		expect(decoded.settings.localFiles.episodes[0].episodeDate).toEqual(episodeDate);
		expect(decoded.settings.playlists.Custom.episodes[0].episodeDate).toEqual(episodeDate);
		expect(decoded.settings.playlists.Custom.currentEpisode?.episodeDate).toEqual(episodeDate);
		expect(decoded.settings.downloadedEpisodes["Test Podcast"][0].episodeDate).toEqual(
			episodeDate,
		);
		expect(decoded.settings.localFiles.episodes[0]).toMatchObject({
			filePath: "Podcasts/local.mp3",
		});
	});

	it("migrates valid legacy values through the existing repair rules", () => {
		const decoded = decodePodNotesData({
			defaultPlaybackRate: 99,
			episodeListLimit: 0,
			skipBackwardLength: null,
			download: { path: "" },
			note: { path: "", template: "" },
			transcript: { path: "custom.md", template: "{{transcript}}" },
			feedNote: { path: "custom-feed.md" },
		});

		expect(decoded.sourceVersion).toBe(0);
		expect(decoded.settings.defaultPlaybackRate).toBe(4);
		expect(decoded.settings.episodeListLimit).toBe(DEFAULT_SETTINGS.episodeListLimit);
		expect(decoded.settings.skipBackwardLength).toBe(DEFAULT_SETTINGS.skipBackwardLength);
		expect(decoded.settings.download.path).toBe(DEFAULT_SETTINGS.download.path);
		expect(decoded.settings.note).toEqual(DEFAULT_SETTINGS.note);
		expect(decoded.settings.transcript).toMatchObject({
			path: "custom.md",
			template: "{{transcript}}",
			diarization: DEFAULT_SETTINGS.transcript.diarization,
		});
		expect(decoded.settings.feedNote).toEqual({
			path: "custom-feed.md",
			template: DEFAULT_SETTINGS.feedNote.template,
		});
	});

	it("preserves an intentionally disabled note feature from schema v1 and on v2 save", () => {
		const decoded = decodePodNotesData({
			schemaVersion: 1,
			note: { path: "", template: "" },
		});
		const persisted = encodePodNotesData(decoded.settings);

		expect(decoded.settings.note).toEqual({ path: "", template: "" });
		expect(persisted.note).toEqual({ path: "", template: "" });
	});

	it("extracts legacy plaintext credentials without putting them in runtime settings", () => {
		const decoded = decodePodNotesData({
			schemaVersion: 1,
			openAIApiKey: "  sk-legacy  ",
			diarizationApiKey: "dg-legacy",
		});

		expect(decoded.legacySecrets).toEqual({ openAI: "sk-legacy", deepgram: "dg-legacy" });
		expect(decoded.settings).not.toHaveProperty("openAIApiKey");
		expect(decoded.settings).not.toHaveProperty("diarizationApiKey");
		expect(decoded.unknownFields).not.toHaveProperty("openAIApiKey");
		expect(decoded.unknownFields).not.toHaveProperty("diarizationApiKey");
	});

	it("retires plaintext fields even if they appear in v2 data", () => {
		const decoded = decodePodNotesData({
			schemaVersion: 2,
			openAIApiKey: "must-not-survive",
			diarizationApiKey: "must-not-survive",
		});
		const persisted = encodePodNotesData(decoded.settings, decoded.unknownFields);

		expect(decoded.legacySecrets).toEqual({});
		expect(decoded.retiredPlaintextPresent).toBe(true);
		expect(decoded.changed).toBe(true);
		expect(decoded.unknownFields).not.toHaveProperty("openAIApiKey");
		expect(decoded.unknownFields).not.toHaveProperty("diarizationApiKey");
		expect(JSON.stringify(persisted)).not.toContain("must-not-survive");
		expect(persisted).not.toHaveProperty("openAIApiKey");
		expect(persisted).not.toHaveProperty("diarizationApiKey");
	});

	it("preserves provider-owned SecretStorage IDs and removes tampered v2 references", () => {
		const valid = decodePodNotesData({
			schemaVersion: 2,
			openAISecretId: "podnotes-openai-api-key-2",
		});
		const foreign = decodePodNotesData({
			schemaVersion: 2,
			openAISecretId: "shared-global-api-key",
			deepgramSecretId: "podnotes-openai-api-key",
		});

		expect(valid.settings.openAISecretId).toBe("podnotes-openai-api-key-2");
		expect(foreign.settings.openAISecretId).toBe("");
		expect(foreign.settings.deepgramSecretId).toBe("");
		expect(foreign.changed).toBe(true);
		expect(foreign.warnings).toContain(
			"openAISecretId: foreign or wrong-provider SecretStorage ID; reference was removed",
		);
		expect(foreign.warnings).toContain(
			"deepgramSecretId: foreign or wrong-provider SecretStorage ID; reference was removed",
		);
	});

	it("salvages valid fields and only drops individually invalid collection entries", () => {
		const validEpisode = {
			...episode("Valid"),
			episodeDate: episodeDate.toISOString(),
		};
		const decoded = decodePodNotesData({
			schemaVersion: 1,
			defaultVolume: 3,
			queue: {
				name: "Queue",
				icon: "list-ordered",
				shouldEpisodeRemoveAfterPlay: true,
				shouldRepeat: false,
				episodes: [validEpisode, { title: 42 }],
			},
			downloadedEpisodes: {
				Podcast: [
					{ ...validEpisode, filePath: "episode.mp3" },
					{ ...validEpisode, title: "No path" },
				],
			},
			playlists: { Valid: playlist("Valid", episode("Playlist")), Broken: null },
		});

		expect(decoded.settings.defaultVolume).toBe(1);
		expect(decoded.settings.queue.episodes.map((item) => item.title)).toEqual(["Valid"]);
		expect(decoded.settings.downloadedEpisodes.Podcast).toHaveLength(1);
		expect(decoded.settings.downloadedEpisodes.Podcast[0]).toMatchObject({
			filePath: "episode.mp3",
			size: 0,
		});
		expect(Object.keys(decoded.settings.playlists)).toEqual(["Valid"]);
		expect(decoded.warnings).toContain("defaultVolume: value was clamped");
		expect(decoded.warnings).toContain(
			"queue.episodes[1].title: expected a string; episode was skipped",
		);
	});

	it("removes an invalid date while preserving the episode", () => {
		const decoded = decodePodNotesData({
			currentEpisode: { ...episode("Restored"), episodeDate: "not-a-date" },
		});

		expect(decoded.settings.currentEpisode).toMatchObject({ title: "Restored" });
		expect(decoded.settings.currentEpisode?.episodeDate).toBeUndefined();
		expect(decoded.warnings).toContain("currentEpisode.episodeDate: invalid date was removed");
	});

	it("backfills fields missing from early episode and download snapshots", () => {
		const early = {
			title: "Early",
			streamUrl: "early.mp3",
			url: "",
			description: "",
			podcastName: "Old Podcast",
			filePath: "early.mp3",
		};
		const decoded = decodePodNotesData({
			currentEpisode: early,
			downloadedEpisodes: { "Old Podcast": [early] },
		});

		expect(decoded.settings.currentEpisode?.content).toBe("");
		expect(decoded.settings.downloadedEpisodes["Old Podcast"][0].size).toBe(0);
	});

	const storedDownload = (downloadedByPodNotes: unknown) => ({
		...episode("Downloaded"),
		episodeDate: episodeDate.toISOString(),
		filePath: "Podcasts/downloaded.mp3",
		size: 42,
		downloadedByPodNotes,
	});

	it("keeps a download PodNotes recorded as its own through load and save", () => {
		const decoded = decodePodNotesData({
			downloadedEpisodes: { "Test Podcast": [storedDownload(true)] },
		});
		const persisted = encodePodNotesData(decoded.settings, decoded.unknownFields);

		expect(decoded.warnings).toEqual([]);
		expect(decoded.settings.downloadedEpisodes["Test Podcast"][0]).toMatchObject({
			downloadedByPodNotes: true,
		});
		expect(persisted.downloadedEpisodes["Test Podcast"][0]).toMatchObject({
			downloadedByPodNotes: true,
		});
	});

	it.each([["true"], [1], [false]])("does not trust download ownership stored as %o", (value) => {
		const decoded = decodePodNotesData({
			downloadedEpisodes: { "Test Podcast": [storedDownload(value)] },
		});

		expect(decoded.settings.downloadedEpisodes["Test Podcast"][0]).not.toHaveProperty(
			"downloadedByPodNotes",
		);
		expect(decoded.warnings).toEqual([
			"downloadedEpisodes.Test Podcast[0].downloadedByPodNotes: value was normalized",
		]);
	});

	it("preserves safe unknown root and nested fields across a schema upgrade", () => {
		const decoded = decodePodNotesData({
			schemaVersion: 1,
			futureRootField: { enabled: true },
			queue: {
				...DEFAULT_SETTINGS.queue,
				futurePlaylistField: "kept",
			},
		});
		const persisted = encodePodNotesData(decoded.settings, decoded.unknownFields);

		expect(persisted.futureRootField).toEqual({ enabled: true });
		expect((persisted.queue as Record<string, unknown>).futurePlaylistField).toBe("kept");
	});

	it("removes a root __proto__ key and keeps a playlist named constructor", () => {
		const raw = JSON.parse(
			'{"schemaVersion":1,"__proto__":{"polluted":true},"playlists":{"constructor":{"episodes":[]}}}',
		) as Record<string, unknown>;
		const decoded = decodePodNotesData(raw);
		const persisted = encodePodNotesData(decoded.settings, decoded.unknownFields);

		expect(decoded.unknownFields).not.toHaveProperty("__proto__");
		expect(Object.keys(decoded.settings.playlists)).toEqual(["constructor"]);
		expect(Object.keys(JSON.parse(JSON.stringify(persisted)))).not.toContain("__proto__");
		expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
	});

	describe("entries named like Object.prototype members", () => {
		const names = ["toString", "__proto__", "constructor", "hasOwnProperty"];
		const maps = [
			"savedFeeds",
			"podNotes",
			"playedEpisodes",
			"playlists",
			"downloadedEpisodes",
		] as const;

		function library(entryNames: readonly string[]): unknown {
			const entries = (value: (name: string) => unknown) =>
				Object.fromEntries(entryNames.map((name) => [name, value(name)]));
			return JSON.parse(
				JSON.stringify({
					schemaVersion: PODNOTES_DATA_SCHEMA_VERSION,
					libraryId: "library",
					savedFeeds: entries((name) => ({
						title: name,
						url: `https://example.com/${name}.xml`,
						artworkUrl: "",
					})),
					podNotes: entries((name) => ({
						episodeName: "Ep",
						filePath: `Notes/${name}.md`,
						podcastFeedKey: name,
					})),
					playedEpisodes: entries((name) => ({
						title: "Ep",
						podcastName: name,
						time: 5,
						duration: 10,
						finished: false,
					})),
					playlists: entries((name) => ({
						name,
						icon: "list",
						episodes: [],
						shouldEpisodeRemoveAfterPlay: false,
						shouldRepeat: false,
					})),
					downloadedEpisodes: entries((name) => [
						{
							title: "Ep",
							podcastName: name,
							streamUrl: `https://example.com/${name}.mp3`,
							url: "",
							description: "",
							content: "",
							filePath: `${name}/Ep.mp3`,
							size: 1,
						},
					]),
				}),
			);
		}

		it("keeps every entry across a save and a reload", () => {
			const loaded = decodePodNotesData(library(names));
			const saved = JSON.stringify(encodePodNotesData(loaded.settings, loaded.unknownFields));
			const reloaded = decodePodNotesData(JSON.parse(saved));

			expect(loaded.warnings).toEqual([]);
			for (const map of maps) {
				expect(Object.keys(reloaded.settings[map]).sort()).toEqual([...names].sort());
			}
			expect(reloaded.settings.savedFeeds["__proto__"].url).toBe(
				"https://example.com/__proto__.xml",
			);
			const [download] = reloaded.settings.downloadedEpisodes[names[0]];
			expect(download.filePath).toBe(`${names[0]}/Ep.mp3`);
			expect(
				JSON.stringify(encodePodNotesData(reloaded.settings, reloaded.unknownFields)),
			).toBe(saved);
			expect(({} as { url?: string }).url).toBeUndefined();
		});

		it("finds nothing under a name the library does not have", () => {
			const { settings } = decodePodNotesData(library([]));

			for (const map of maps) {
				for (const name of [...names, "valueOf"]) {
					expect(settings[map][name], `${map}.${name}`).toBeUndefined();
				}
			}
		});
	});

	it.each([[[]], ["data"], [42], [true]])("fails closed for malformed root %o", (value) => {
		expect(() => decodePodNotesData(value)).toThrowError(PodNotesDataError);
	});

	it.each([0, -1, 1.5, "1", null])("fails closed for invalid schema version %o", (version) => {
		expect(() => decodePodNotesData({ schemaVersion: version })).toThrowError(
			/invalid schemaVersion/,
		);
	});

	it("fails closed for a future schema version", () => {
		expect(() => decodePodNotesData({ schemaVersion: 3 })).toThrowError(
			/schema v3 requires a newer version/,
		);
	});
});

/** An existing listener's data.json, apart from the timestamp setting under test. */
const listenerData = {
	savedFeeds: {
		"Test Podcast": {
			title: "Test Podcast",
			url: "https://example.com/feed.xml",
			artworkUrl: "https://example.com/artwork.jpg",
		},
	},
	podNotes: {},
	defaultPlaybackRate: 1.5,
	defaultVolume: 0.8,
	hidePlayedEpisodes: false,
	episodeListLimit: 10,
	playedEpisodes: {
		"Test Podcast::Episode 1": {
			title: "Episode 1",
			podcastName: "Test Podcast",
			time: 1830,
			duration: 3600,
			finished: false,
		},
	},
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
	skipForwardLength: 30,
	note: { path: "Podcasts/{{title}}.md", template: "# {{title}}\n\n{{description}}" },
	download: { path: "Podcasts/{{podcast}}/{{title}}" },
	downloadedEpisodes: {},
	localFiles: {
		icon: "folder",
		name: "Local Files",
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
		episodes: [],
	},
};

describe("timestamp template (#345)", () => {
	it.each([null, undefined])("captures timestamps as links on a new install (%o)", (data) => {
		const decoded = decodePodNotesData(data);

		expect(decoded.settings.timestamp.template).toBe("- {{linktime}} ");
		expect(decoded.warnings).toEqual([]);
		expect(decoded.changed).toBe(true);
	});

	it.each(["- {{time}} ", "* {{time:mm:ss}} - "])(
		"keeps the saved template %o through load and save",
		(template) => {
			const decoded = decodePodNotesData({
				...listenerData,
				schemaVersion: 2,
				openAISecretId: "",
				deepgramSecretId: "",
				timestamp: { template, offset: 0 },
			});
			const persisted = encodePodNotesData(decoded.settings, decoded.unknownFields);

			expect(decoded.warnings).toEqual([]);
			expect(decoded.changed).toBe(false);
			expect(decoded.settings.timestamp).toEqual({ template, offset: 0 });
			expect(persisted.timestamp).toEqual({ template, offset: 0 });
		},
	);

	it.each([
		["no timestamp setting", listenerData, 0, []],
		["only a timestamp offset", { ...listenerData, timestamp: { offset: 5 } }, 5, []],
		[
			"a non-string template",
			{ ...listenerData, timestamp: { template: 42, offset: 0 } },
			0,
			["timestamp.template: expected a string"],
		],
	])("keeps plain timestamps for older data with %s", (_case, data, offset, warnings) => {
		const decoded = decodePodNotesData(data);

		expect(decoded.sourceVersion).toBe(0);
		expect(decoded.settings.timestamp).toEqual({ template: "- {{time}} ", offset });
		expect(decoded.warnings).toEqual(warnings);
	});
});
