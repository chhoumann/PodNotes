// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Notice, type SecretStorage } from "obsidian";
import { DEFAULT_SETTINGS } from "./constants";
import PodNotes from "./main";
import { encodePodNotesData } from "./persistence/podNotesData";
import { downloadedEpisodes, localFiles } from "./store";
import { bindStoresToSettings } from "./store/persistence";
import { CredentialRepository } from "./services/CredentialRepository";
import { attachDataFileWriter, dataFileText } from "../tests/mocks/dataFileWriter";

function memorySecretStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const storage = {
		getSecret: vi.fn((id: string) => values.get(id) ?? null),
		setSecret: vi.fn((id: string, value: string) => values.set(id, value)),
		listSecrets: vi.fn(() => [...values.keys()]),
	} as unknown as SecretStorage;
	return { storage, values };
}

function makePlugin(
	saveData: (data: unknown) => Promise<void> = vi.fn().mockResolvedValue(undefined),
	{ dataFileExists = false } = {},
): PodNotes {
	const { storage } = memorySecretStorage();
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	let disk: unknown = JSON.parse(
		JSON.stringify(encodePodNotesData(structuredClone(DEFAULT_SETTINGS))),
	);
	Object.assign(plugin, {
		app: {
			secretStorage: storage,
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(dataFileExists),
					read: vi.fn(async () => dataFileText(disk)),
				},
			},
		},
		manifest: { dir: ".obsidian/plugins/podnotes" },
		credentials: new CredentialRepository(storage),
		isReady: true,
		settings: structuredClone(DEFAULT_SETTINGS),
		persistenceUnknownFields: {},
		loadData: vi.fn(async () => structuredClone(disk)),
		saveData: async (data: unknown) => {
			await saveData(data);
			disk = structuredClone(data);
		},
	});
	attachDataFileWriter(plugin);
	return plugin;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("PodNotes persistence integration", () => {
	it("loads legacy JSON dates as Date instances", async () => {
		const plugin = makePlugin();
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue({
				currentEpisode: {
					title: "Restored",
					streamUrl: "restored.mp3",
					url: "",
					description: "",
					content: "",
					podcastName: "Podcast",
					episodeDate: "2024-03-01T10:05:03.000Z",
				},
			}),
		});

		await plugin.loadSettings();

		expect(plugin.settings.currentEpisode?.episodeDate).toEqual(
			new Date("2024-03-01T10:05:03.000Z"),
		);
	});

	it("refuses future data before any save can overwrite it", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue({ schemaVersion: 3 }),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow(/schema v3/);
		expect(saveData).not.toHaveBeenCalled();
	});

	it("writes schema v2, canonical dates, and preserved unknown fields", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		plugin.settings.currentEpisode = {
			title: "Current",
			streamUrl: "current.mp3",
			url: "",
			description: "",
			content: "",
			podcastName: "Podcast",
			episodeDate: new Date("2024-03-01T10:05:03.000Z"),
		};
		Object.assign(plugin, { persistenceUnknownFields: { retained: { enabled: true } } });

		await plugin.saveSettingsStrict();

		expect(saveData).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaVersion: 2,
				retained: { enabled: true },
				currentEpisode: expect.objectContaining({
					episodeDate: "2024-03-01T10:05:03.000Z",
				}),
			}),
		);
	});

	it("moves legacy credentials into SecretStorage before writing schema v2", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const { storage, values } = memorySecretStorage();
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			app: { ...plugin.app, secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue({
				schemaVersion: 1,
				openAIApiKey: "sk-legacy",
				diarizationApiKey: "dg-legacy",
				retained: true,
			}),
		});

		await plugin.loadSettings();

		expect(values.get("podnotes-openai-api-key")).toBe("sk-legacy");
		expect(values.get("podnotes-deepgram-api-key")).toBe("dg-legacy");
		expect(plugin.settings.openAISecretId).toBe("podnotes-openai-api-key");
		expect(plugin.settings.deepgramSecretId).toBe("podnotes-deepgram-api-key");
		expect(saveData).toHaveBeenCalledTimes(1);
		const persisted = saveData.mock.calls[0][0] as Record<string, unknown>;
		expect(persisted).toEqual(
			expect.objectContaining({
				schemaVersion: 2,
				openAISecretId: "podnotes-openai-api-key",
				deepgramSecretId: "podnotes-deepgram-api-key",
				retained: true,
			}),
		);
		expect(persisted).not.toHaveProperty("openAIApiKey");
		expect(persisted).not.toHaveProperty("diarizationApiKey");
	});

	it("leaves legacy data untouched when SecretStorage migration fails", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const raw = { schemaVersion: 1, openAIApiKey: "sk", defaultVolume: 0.3 };
		const storage = {
			getSecret: vi.fn(() => null),
			setSecret: vi.fn(() => {
				throw new Error("keychain unavailable");
			}),
			listSecrets: vi.fn(() => []),
		} as unknown as SecretStorage;
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			app: { ...plugin.app, secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue(raw),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow("keychain unavailable");
		expect(saveData).not.toHaveBeenCalled();
		expect(raw).toEqual({ schemaVersion: 1, openAIApiKey: "sk", defaultVolume: 0.3 });
	});

	it("does not save v2 when the second credential write fails", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const values = new Map<string, string>();
		const storage = {
			getSecret: vi.fn((id: string) => values.get(id) ?? null),
			setSecret: vi.fn((id: string, value: string) => {
				if (id.startsWith("podnotes-deepgram")) throw new Error("Deepgram write failed");
				values.set(id, value);
			}),
			listSecrets: vi.fn(() => [...values.keys()]),
		} as unknown as SecretStorage;
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			app: { ...plugin.app, secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue({
				schemaVersion: 1,
				openAIApiKey: "sk-created",
				diarizationApiKey: "dg-fails",
			}),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow("Deepgram write failed");
		expect(values.get("podnotes-openai-api-key")).toBe("sk-created");
		expect(saveData).not.toHaveBeenCalled();
	});

	it("reuses an already-created secret after the v2 save fails and is retried", async () => {
		const { storage, values } = memorySecretStorage();
		const raw = { schemaVersion: 1, openAIApiKey: "sk-retry" };
		const first = makePlugin(vi.fn().mockRejectedValue(new Error("disk full")));
		Object.assign(first, {
			app: { ...first.app, secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue(raw),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(first.loadSettings()).rejects.toThrow("disk full");
		expect(values.get("podnotes-openai-api-key")).toBe("sk-retry");

		const retrySave = vi.fn().mockResolvedValue(undefined);
		const retry = makePlugin(retrySave);
		Object.assign(retry, {
			app: { ...retry.app, secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue(raw),
		});
		await retry.loadSettings();

		expect(retry.settings.openAISecretId).toBe("podnotes-openai-api-key");
		expect(values.has("podnotes-openai-api-key-2")).toBe(false);
		expect(retrySave).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaVersion: 2,
				openAISecretId: "podnotes-openai-api-key",
			}),
		);
	});

	it("writes timestamp links as the capture default on a new install", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(null) });

		await plugin.loadSettings();

		expect(saveData).toHaveBeenCalledTimes(1);
		expect(saveData).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaVersion: 2,
				timestamp: { template: "- {{linktime}} ", offset: 0 },
			}),
		);
	});

	it("leaves a data.json it cannot read unchanged and refuses every save", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData, { dataFileExists: true });
		const privateFeedUrl = "podnotes-feed-url-00000000-0000-4000-8000-000000000000";
		const { storage, values } = memorySecretStorage({
			[privateFeedUrl]: "https://user:token@example.com/feed.xml",
		});
		Object.assign(plugin, {
			app: { ...plugin.app, secretStorage: storage },
			loadData: vi.fn().mockResolvedValue(undefined),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await plugin.loadSettings();
		await plugin.saveSettings();

		await expect(plugin.saveSettingsStrict()).rejects.toThrow(/could not read/);
		expect(saveData).not.toHaveBeenCalled();
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
		expect(values.get(privateFeedUrl)).toBe("https://user:token@example.com/feed.xml");
	});

	it("starts no write once the window unloads and rejects the queued strict save", async () => {
		const resolvers: Array<() => void> = [];
		const saveData = vi.fn(() => new Promise<void>((resolve) => resolvers.push(resolve)));
		const plugin = makePlugin(saveData);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		plugin.settings.defaultVolume = 0.5;
		void plugin.saveSettingsStrict();
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
		plugin.settings.defaultVolume = 0.25;
		const queued = plugin.saveSettingsStrict();
		Object.assign(plugin, { writeRefusal: "window-unloading" });
		const late = plugin.saveSettingsStrict();
		resolvers[0]();

		await expect(queued).rejects.toThrow("window unloads");
		await expect(late).rejects.toThrow("window unloads");
		expect(saveData).toHaveBeenCalledTimes(1);
	});

	it("keeps this device's queue when the synced file's queue had to be repaired", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		const queued = (title: string) => ({
			title,
			podcastName: "Pod",
			streamUrl: `https://example.com/${title}.mp3`,
			url: "",
			description: "",
			content: "",
		});
		plugin.settings.queue.episodes = [queued("A"), queued("B")];
		attachDataFileWriter(plugin);
		const synced = JSON.parse(JSON.stringify(encodePodNotesData(plugin.settings)));
		synced.queue = "not a playlist";
		synced.savedFeeds = {
			Synced: { title: "Synced", url: "https://example.com/s.xml", artworkUrl: "" },
		};
		Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(synced) });

		await plugin.onExternalSettingsChange();

		expect(plugin.settings.queue.episodes.map((episode) => episode.title)).toEqual(["A", "B"]);
		expect(Object.keys(plugin.settings.savedFeeds)).toEqual(["Synced"]);

		plugin.settings.defaultVolume = 0.5;
		await plugin.saveSettingsStrict();
		expect(saveData.mock.lastCall?.[0].queue.episodes).toHaveLength(2);
	});

	it("takes progress another device made even when the synced file had to repair another record", async () => {
		const plugin = makePlugin(vi.fn().mockResolvedValue(undefined));
		const progress = (title: string, time: number) => ({
			title,
			podcastName: "Pod",
			time,
			duration: 3600,
			finished: false,
		});
		plugin.settings.playedEpisodes = {
			"Pod::A": progress("A", 10),
			"Pod::B": progress("B", 20),
		};
		attachDataFileWriter(plugin);
		const synced = JSON.parse(JSON.stringify(encodePodNotesData(plugin.settings)));
		synced.playedEpisodes["Pod::A"].time = 99;
		synced.playedEpisodes["Pod::B"].time = -5;
		Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(synced) });

		await plugin.onExternalSettingsChange();

		expect(plugin.settings.playedEpisodes["Pod::A"].time).toBe(99);
	});

	describe("once a data.json it could not read at startup becomes readable", () => {
		async function startUnreadable(saveData: (data: unknown) => Promise<void>) {
			const plugin = makePlugin(saveData, { dataFileExists: true });
			Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(undefined) });
			vi.spyOn(console, "error").mockImplementation(() => undefined);
			vi.spyOn(console, "warn").mockImplementation(() => undefined);
			await plugin.loadSettings();
			attachDataFileWriter(plugin);
			const readable = JSON.parse(JSON.stringify(encodePodNotesData(DEFAULT_SETTINGS)));
			readable.savedFeeds = {
				Recovered: { title: "Recovered", url: "https://example.com/r.xml", artworkUrl: "" },
			};
			return { plugin, readable };
		}

		it("takes it and saves again", async () => {
			const saveData = vi.fn().mockResolvedValue(undefined);
			const { plugin, readable } = await startUnreadable(saveData);
			Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(readable) });

			await plugin.onExternalSettingsChange();
			await plugin.saveSettingsStrict();

			expect(Object.keys(plugin.settings.savedFeeds)).toEqual(["Recovered"]);
		});

		it("keeps refusing saves when reading it would drop a record", async () => {
			const saveData = vi.fn().mockResolvedValue(undefined);
			const { plugin, readable } = await startUnreadable(saveData);
			readable.queue.episodes = [{ title: 388, description: 1, content: 2 }];
			Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(readable) });

			await plugin.onExternalSettingsChange();

			await expect(plugin.saveSettingsStrict()).rejects.toThrow(/could not read/);
			expect(saveData).not.toHaveBeenCalled();
			expect(plugin.settings.savedFeeds).toEqual({});
		});
	});

	it("never saves over a data.json an older version synced in, so its API keys survive", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		const { storage, values } = memorySecretStorage();
		const older = {
			...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
			schemaVersion: 1,
			openAIApiKey: "sk-test-older-device",
			diarizationApiKey: "dg-test-older-device",
		};
		Object.assign(plugin, {
			app: { ...plugin.app, secretStorage: storage },
			loadData: vi.fn().mockResolvedValue(older),
		});
		vi.spyOn(console, "warn").mockImplementation(() => undefined);

		await plugin.onExternalSettingsChange();
		plugin.settings.defaultVolume = 0.5;

		await expect(plugin.saveSettingsStrict()).rejects.toThrow(/older version/);
		expect(saveData).not.toHaveBeenCalled();
		expect(values.size).toBe(0);
	});

	it("saves an unrelated edit when a synced queue entry's podcast name is not text", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		const queued = {
			title: "A",
			podcastName: "Pod",
			streamUrl: "https://example.com/a.mp3",
			url: "",
			description: "",
			content: "",
		};
		plugin.settings.queue.episodes = [queued];
		attachDataFileWriter(plugin);
		const synced = JSON.parse(JSON.stringify(encodePodNotesData(plugin.settings)));
		synced.queue.episodes = [{ ...queued, podcastName: 388 }];
		Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(synced) });

		await plugin.onExternalSettingsChange();
		plugin.settings.defaultVolume = 0.5;
		await plugin.saveSettingsStrict();

		expect(saveData.mock.lastCall?.[0].defaultVolume).toBe(0.5);
	});

	it("rebuilds Local Files from the download entry the merge kept", async () => {
		const download = (streamUrl: string, filePath: string, size: number) => ({
			title: "Ep",
			podcastName: "Pod",
			streamUrl,
			url: "",
			description: "",
			content: "",
			filePath,
			size,
		});
		const plugin = makePlugin();
		plugin.settings.downloadedEpisodes = { Pod: [download("U", "P0", 1)] };
		plugin.settings.localFiles.episodes = [download("U", "P0", 1)];
		attachDataFileWriter(plugin);
		localFiles.set(plugin.settings.localFiles);
		downloadedEpisodes.set(plugin.settings.downloadedEpisodes);
		const unbind = bindStoresToSettings(plugin);
		const unmirror = downloadedEpisodes.subscribe((downloaded) =>
			localFiles.syncWithDownloaded(downloaded),
		);
		try {
			// Another device replaced the download; its Local Files entry did not follow.
			const synced = JSON.parse(JSON.stringify(encodePodNotesData(plugin.settings)));
			synced.downloadedEpisodes = { Pod: [download("V", "P2", 3)] };
			Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(synced) });

			await plugin.onExternalSettingsChange();

			expect(plugin.settings.localFiles.episodes).toEqual([download("V", "P2", 3)]);
		} finally {
			unbind();
			unmirror();
		}
	});

	it("keeps fields this version does not know on Local Files when a synced download arrives", async () => {
		const plugin = makePlugin();
		localFiles.set(plugin.settings.localFiles);
		downloadedEpisodes.set(plugin.settings.downloadedEpisodes);
		const unbind = bindStoresToSettings(plugin);
		const unmirror = downloadedEpisodes.subscribe((downloaded) =>
			localFiles.syncWithDownloaded(downloaded),
		);
		try {
			const download = {
				title: "Ep",
				podcastName: "Pod",
				streamUrl: "https://example.com/ep.mp3",
				url: "",
				description: "",
				content: "",
				filePath: "Podcasts/Ep.mp3",
				size: 1,
			};
			const synced = JSON.parse(JSON.stringify(encodePodNotesData(plugin.settings)));
			synced.downloadedEpisodes = { Pod: [download] };
			synced.localFiles = { ...synced.localFiles, episodes: [download], futureField: "kept" };
			Object.assign(plugin, { loadData: vi.fn().mockResolvedValue(synced) });

			await plugin.onExternalSettingsChange();

			expect(plugin.settings.localFiles).toMatchObject({ futureField: "kept" });
			expect(plugin.settings.localFiles.episodes).toHaveLength(1);
		} finally {
			unbind();
			unmirror();
		}
	});

	it("starts no migration write once the window unloads", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue({ defaultVolume: 0.4 }),
			writeRefusal: "window-unloading",
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow("window unloads");
		expect(saveData).not.toHaveBeenCalled();
	});

	it("does not rewrite data that is already schema v2", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue({ schemaVersion: 2, defaultVolume: 0.4 }),
		});

		await plugin.loadSettings();

		expect(plugin.settings.defaultVolume).toBe(0.4);
		expect(saveData).not.toHaveBeenCalled();
	});

	it("scrubs retired plaintext fields from schema v2 without importing them", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const { storage, values } = memorySecretStorage();
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			app: { ...plugin.app, secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue({
				schemaVersion: 2,
				openAIApiKey: "must-not-import",
				defaultVolume: 0.4,
			}),
		});

		await plugin.loadSettings();

		expect(values.size).toBe(0);
		expect(plugin.settings.openAISecretId).toBe("");
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(saveData.mock.calls[0][0]).toEqual(
			expect.objectContaining({ schemaVersion: 2, defaultVolume: 0.4 }),
		);
		expect(saveData.mock.calls[0][0]).not.toHaveProperty("openAIApiKey");
	});

	it("fails closed if a v2 retired-field scrub cannot be persisted", async () => {
		const plugin = makePlugin(vi.fn().mockRejectedValue(new Error("disk full")));
		Object.assign(plugin, {
			loadData: vi
				.fn()
				.mockResolvedValue({ schemaVersion: 2, openAIApiKey: "must-stay-unread" }),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow("disk full");
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it("treats a save Obsidian reported but did not write as failed, even at the same size", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		const reportedOnly = vi.fn().mockResolvedValue(undefined);
		const writes = plugin.saveData.bind(plugin);
		// Obsidian's saveData resolves even when its write fails.
		Object.assign(plugin, { saveData: reportedOnly });
		plugin.settings.skipBackwardLength = 16;

		await expect(plugin.saveSettingsStrict()).rejects.toThrow(/could not write/);

		Object.assign(plugin, { saveData: writes });
		plugin.settings.defaultPlaybackRate = 1.5;
		await plugin.saveSettingsStrict();
		expect(saveData.mock.lastCall?.[0]).toMatchObject({
			skipBackwardLength: 16,
			defaultPlaybackRate: 1.5,
		});
	});

	describe("when a write is cut short, as on a full disk", () => {
		function cutShortOnce() {
			const plugin = makePlugin();
			const synced = JSON.parse(JSON.stringify(encodePodNotesData(plugin.settings)));
			synced.savedFeeds = {
				Synced: { title: "Synced", url: "https://example.com/s.xml", artworkUrl: "" },
			};
			const disk = { text: JSON.stringify(synced, undefined, 2), full: true };
			Object.assign(plugin, {
				loadData: vi.fn(async () => {
					try {
						return JSON.parse(disk.text);
					} catch {
						return undefined;
					}
				}),
				saveData: vi.fn(async (data: unknown) => {
					const text = JSON.stringify(data, undefined, 2);
					disk.text = disk.full ? text.slice(0, 100) : text;
					disk.full = false;
				}),
			});
			Object.assign(plugin.app.vault.adapter, {
				exists: vi.fn().mockResolvedValue(true),
				read: vi.fn(async () => disk.text),
			});
			return { plugin, disk };
		}

		it("never writes over the file it cut short, even to finish its own write", async () => {
			const { plugin, disk } = cutShortOnce();
			plugin.settings.defaultVolume = 0.5;
			await expect(plugin.saveSettingsStrict()).rejects.toThrow(/could not write/);
			const cutShort = disk.text;

			plugin.settings.defaultVolume = 0.25;
			await expect(plugin.saveSettingsStrict()).rejects.toThrow(/could not read/);

			expect(disk.text).toBe(cutShort);
		});

		it("never writes over a file another writer left unreadable", async () => {
			const { plugin, disk } = cutShortOnce();
			disk.full = false;
			disk.text = '{"schemaVersion": 2, "savedFeeds": {"Other device';

			plugin.settings.defaultVolume = 0.25;
			await expect(plugin.saveSettingsStrict()).rejects.toThrow(/could not read/);

			expect(disk.text).toBe('{"schemaVersion": 2, "savedFeeds": {"Other device');
		});

		it("stops saving while the file cannot be read, and saves again once it can", async () => {
			const { plugin, disk } = cutShortOnce();
			const readable = disk.text;
			disk.full = false;
			disk.text = '{"schemaVersion": 2, "savedFeeds": {"Other device';
			plugin.settings.defaultVolume = 0.25;
			await expect(plugin.saveSettingsStrict()).rejects.toThrow(/could not read/);
			// Refused now, with the Notice up: no save even tries to read the file.
			await expect(plugin.saveSettingsStrict()).rejects.toThrow(/does not save over/);
			const hideNotice = vi.spyOn(Notice.prototype, "hide");

			disk.text = readable;
			await plugin.onExternalSettingsChange();
			expect(hideNotice).toHaveBeenCalled();
			await plugin.saveSettingsStrict();
			expect(JSON.parse(disk.text)).toMatchObject({
				defaultVolume: 0.25,
				savedFeeds: { Synced: { title: "Synced" } },
			});
		});

		it("never writes over a file a newer PodNotes wrote since", async () => {
			const { plugin, disk } = cutShortOnce();
			plugin.settings.defaultVolume = 0.5;
			await expect(plugin.saveSettingsStrict()).rejects.toThrow(/could not write/);
			disk.text = JSON.stringify({ schemaVersion: 3 });

			await expect(plugin.saveSettingsStrict()).rejects.toThrow(/newer version/);

			expect(disk.text).toBe(JSON.stringify({ schemaVersion: 3 }));
		});
	});

	it("rejects a strict caller when saveData fails", async () => {
		const failure = new Error("disk full");
		const plugin = makePlugin(vi.fn().mockRejectedValue(failure));
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		plugin.settings.defaultVolume = 0.5;

		await expect(plugin.saveSettingsStrict()).rejects.toBe(failure);
	});

	it("keeps best-effort saves nonrejecting while logging disk failure", async () => {
		const failure = new Error("disk full");
		const plugin = makePlugin(vi.fn().mockRejectedValue(failure));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		plugin.settings.defaultVolume = 0.5;

		await expect(plugin.saveSettings()).resolves.toBeUndefined();
		await expect(plugin.flushSaves()).resolves.toBeUndefined();
		expect(consoleError).toHaveBeenCalledWith("PodNotes: failed to save settings", failure);
	});

	it("keeps later callers pending until their newer snapshot is durable", async () => {
		const resolvers: Array<() => void> = [];
		const writes: unknown[] = [];
		const plugin = makePlugin(
			vi.fn((data: unknown) => {
				writes.push(data);
				return new Promise<void>((resolve) => resolvers.push(resolve));
			}),
		);

		plugin.settings.defaultVolume = 0.5;
		const first = plugin.saveSettingsStrict();
		await vi.waitFor(() => expect(writes).toHaveLength(1));
		plugin.settings.defaultVolume = 0.25;
		const second = plugin.saveSettingsStrict();
		let secondResolved = false;
		void second.then(() => {
			secondResolved = true;
		});

		resolvers[0]();
		await first;
		await vi.waitFor(() => expect(writes).toHaveLength(2));
		expect(secondResolved).toBe(false);
		expect(writes[1]).toEqual(expect.objectContaining({ defaultVolume: 0.25 }));

		resolvers[1]();
		await second;
		expect(secondResolved).toBe(true);
	});
});
