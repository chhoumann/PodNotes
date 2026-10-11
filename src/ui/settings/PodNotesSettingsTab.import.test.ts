// @vitest-environment jsdom
import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import * as obsidian from "obsidian";

import { DEFAULT_SETTINGS } from "src/constants";
import PodNotes from "src/main";
import { episodeListLimit, hidePlayedEpisodes, playbackRate, savedFeeds, volume } from "src/store";
import { bindStoresToSettings } from "src/store/persistence";
import { PodNotesSettingsTab } from "./PodNotesSettingsTab";
import { attachDataFileWriter, dataFileText } from "../../../tests/mocks/dataFileWriter";

function deferred<T = void>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe("PodNotesSettingsTab settings import", () => {
	it("rehydrates the live playback-rate store when importing a new default", async () => {
		playbackRate.set(1);
		const plugin = {
			settings: structuredClone(DEFAULT_SETTINGS),
			credentials: { storeValues: vi.fn(() => ({})) },
			saveSettings: vi.fn().mockResolvedValue(undefined),
			saveSettingsStrict: vi.fn().mockResolvedValue(undefined),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(tab, "update").mockImplementation(() => {});

		await (
			tab as unknown as {
				applyImportedSettings: (
					imported: Partial<typeof DEFAULT_SETTINGS>,
				) => Promise<void>;
			}
		).applyImportedSettings({ defaultPlaybackRate: 2.3 });

		expect(plugin.settings.defaultPlaybackRate).toBe(2.3);
		expect(get(playbackRate)).toBe(2.3);
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(2);
	});

	it("restores the previous settings and reports a strict save failure", async () => {
		playbackRate.set(1);
		const previous = structuredClone(DEFAULT_SETTINGS);
		const failure = new Error("disk full");
		const plugin = {
			settings: previous,
			credentials: { storeValues: vi.fn(() => ({})) },
			saveSettings: vi.fn().mockResolvedValue(undefined),
			saveSettingsStrict: vi
				.fn()
				.mockRejectedValueOnce(failure)
				.mockResolvedValueOnce(undefined),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		const update = vi.spyOn(tab, "update").mockImplementation(() => {});
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await (
			tab as unknown as {
				applyImportedSettings: (
					imported: Partial<typeof DEFAULT_SETTINGS>,
				) => Promise<void>;
			}
		).applyImportedSettings({ defaultPlaybackRate: 2.3 });

		expect(plugin.settings).toBe(previous);
		expect(get(playbackRate)).toBe(1);
		expect(update).not.toHaveBeenCalled();
		expect(notice).toHaveBeenCalledWith(
			"Could not import PodNotes settings. The failed import was rolled back without overwriting newer changes.",
			10000,
		);
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(2);
	});

	it("locks ordinary settings controls until an import and its lane drain finish", async () => {
		const firstSave = deferred();
		const plugin = {
			settings: structuredClone(DEFAULT_SETTINGS),
			credentials: { storeValues: vi.fn(() => ({})) },
			saveSettings: vi.fn().mockResolvedValue(undefined),
			saveSettingsStrict: vi
				.fn()
				.mockImplementationOnce(() => firstSave.promise)
				.mockResolvedValue(undefined),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		const enabledInput = tab.containerEl.createEl("input");
		const disabledButton = tab.containerEl.createEl("button");
		disabledButton.disabled = true;
		vi.spyOn(tab, "update").mockImplementation(() => {});

		const importing = (
			tab as unknown as {
				applyImportedSettings: (
					imported: Partial<typeof DEFAULT_SETTINGS>,
				) => Promise<void>;
			}
		).applyImportedSettings({ defaultPlaybackRate: 2 });
		expect(enabledInput.disabled).toBe(true);
		expect(disabledButton.disabled).toBe(true);

		firstSave.resolve();
		await importing;

		expect(enabledInput.disabled).toBe(false);
		expect(disabledButton.disabled).toBe(true);
		playbackRate.set(DEFAULT_SETTINGS.defaultPlaybackRate);
	});

	it("stores imported secret values first and persists only their references", async () => {
		const plugin = {
			settings: structuredClone(DEFAULT_SETTINGS),
			credentials: {
				storeValues: vi.fn(() => ({
					openAISecretId: "podnotes-openai-api-key",
					deepgramSecretId: "podnotes-deepgram-api-key",
				})),
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
			saveSettingsStrict: vi.fn().mockResolvedValue(undefined),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(tab, "update").mockImplementation(() => {});

		await (
			tab as unknown as {
				applyImportedSettings: (
					imported: Partial<typeof DEFAULT_SETTINGS>,
					secrets: { openAI?: string; deepgram?: string },
				) => Promise<void>;
			}
		).applyImportedSettings({ defaultVolume: 0.4 }, { openAI: "sk", deepgram: "dg" });

		expect(plugin.credentials.storeValues).toHaveBeenCalledWith({
			openAI: "sk",
			deepgram: "dg",
		});
		expect(plugin.settings.openAISecretId).toBe("podnotes-openai-api-key");
		expect(plugin.settings.deepgramSecretId).toBe("podnotes-deepgram-api-key");
		expect(plugin.settings).not.toHaveProperty("openAIApiKey");
		expect(plugin.settings).not.toHaveProperty("diarizationApiKey");
	});

	it("does not mutate settings when SecretStorage import fails partway", async () => {
		const previous = structuredClone(DEFAULT_SETTINGS);
		const plugin = {
			settings: previous,
			credentials: {
				storeValues: vi.fn(() => {
					throw new Error("second credential failed");
				}),
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
			saveSettingsStrict: vi.fn().mockResolvedValue(undefined),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await (
			tab as unknown as {
				applyImportedSettings: (
					imported: Partial<typeof DEFAULT_SETTINGS>,
					secrets: { openAI?: string; deepgram?: string },
				) => Promise<void>;
			}
		).applyImportedSettings({ defaultVolume: 0.4 }, { openAI: "sk", deepgram: "dg" });

		expect(plugin.settings).toBe(previous);
		expect(plugin.saveSettingsStrict).not.toHaveBeenCalled();
		expect(notice).toHaveBeenCalledWith(
			expect.stringContaining("retrying will safely reuse"),
			10000,
		);
	});

	it("restores previous secret references when the settings save fails", async () => {
		const previous = {
			...structuredClone(DEFAULT_SETTINGS),
			openAISecretId: "podnotes-openai-api-key",
		};
		const plugin = {
			settings: previous,
			credentials: {
				storeValues: vi.fn(() => ({ openAISecretId: "podnotes-openai-api-key-2" })),
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
			saveSettingsStrict: vi
				.fn()
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValueOnce(undefined),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await (
			tab as unknown as {
				applyImportedSettings: (
					imported: Partial<typeof DEFAULT_SETTINGS>,
					secrets: { openAI?: string },
				) => Promise<void>;
			}
		).applyImportedSettings({ defaultVolume: 0.4 }, { openAI: "sk-new" });

		expect(plugin.settings).toBe(previous);
		expect(plugin.settings.openAISecretId).toBe("podnotes-openai-api-key");
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(2);
	});

	it("rolls back a SecretComponent reference when strict persistence fails", async () => {
		const plugin = {
			settings: {
				...structuredClone(DEFAULT_SETTINGS),
				openAISecretId: "podnotes-openai-api-key",
			},
			credentials: {
				adoptReference: vi.fn(() => "podnotes-openai-api-key-2"),
			},
			saveSettingsStrict: vi
				.fn()
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValueOnce(undefined),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const saved = await (
			tab as unknown as {
				saveSecretReference: (
					key: "openAISecretId",
					value: string,
				) => Promise<{ persistedId: string; saved: boolean; isLatest: boolean }>;
			}
		).saveSecretReference("openAISecretId", "shared-new-secret");

		expect(saved).toEqual({
			persistedId: "podnotes-openai-api-key",
			saved: false,
			isLatest: true,
		});
		expect(plugin.settings.openAISecretId).toBe("podnotes-openai-api-key");
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(2);
	});

	it("keeps a newer selection authoritative when an older save fails", async () => {
		const firstSave = deferred();
		let disk = "podnotes-openai-api-key";
		let saveCall = 0;
		const plugin = {
			settings: {
				...structuredClone(DEFAULT_SETTINGS),
				openAISecretId: disk,
			},
			credentials: {
				adoptReference: vi.fn((_kind: string, id: string) =>
					id === "shared-a" ? "podnotes-openai-api-key-2" : "podnotes-openai-api-key-3",
				),
			},
			saveSettingsStrict: vi.fn(() => {
				const snapshot = plugin.settings.openAISecretId;
				saveCall++;
				if (saveCall === 1) {
					return firstSave.promise.then(() => {
						disk = snapshot;
					});
				}
				disk = snapshot;
				return Promise.resolve();
			}),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		let ui = "shared-a";
		const secret = {
			setValue: vi.fn((value: string) => {
				ui = value;
				return secret;
			}),
		};
		const handle = (
			tab as unknown as {
				handleSecretSelection: (
					key: "openAISecretId",
					value: string,
					component: typeof secret,
					onSettled: () => void,
				) => Promise<void>;
			}
		).handleSecretSelection.bind(tab);

		const older = handle("openAISecretId", "shared-a", secret, vi.fn());
		await Promise.resolve();
		ui = "shared-b";
		const newer = handle("openAISecretId", "shared-b", secret, vi.fn());
		firstSave.reject(new Error("first save failed"));
		await Promise.all([older, newer]);

		expect(plugin.settings.openAISecretId).toBe("podnotes-openai-api-key-3");
		expect(disk).toBe("podnotes-openai-api-key-3");
		expect(ui).toBe("podnotes-openai-api-key-3");
		expect(secret.setValue).toHaveBeenCalledTimes(1);
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(3);
	});

	it("restores the last durable selection when the newer overlapping save fails", async () => {
		const firstSave = deferred();
		const secondSave = deferred();
		let disk = "podnotes-openai-api-key";
		let saveCall = 0;
		const plugin = {
			settings: {
				...structuredClone(DEFAULT_SETTINGS),
				openAISecretId: disk,
			},
			credentials: {
				adoptReference: vi.fn((_kind: string, id: string) =>
					id === "shared-a" ? "podnotes-openai-api-key-2" : "podnotes-openai-api-key-3",
				),
			},
			saveSettingsStrict: vi.fn(() => {
				const snapshot = plugin.settings.openAISecretId;
				saveCall++;
				if (saveCall === 1) {
					return firstSave.promise.then(() => {
						disk = snapshot;
					});
				}
				if (saveCall === 2) {
					return secondSave.promise.then(() => {
						disk = snapshot;
					});
				}
				disk = snapshot;
				return Promise.resolve();
			}),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		let ui = "shared-b";
		const secret = {
			setValue: vi.fn((value: string) => {
				ui = value;
				return secret;
			}),
		};
		const handle = (
			tab as unknown as {
				handleSecretSelection: (
					key: "openAISecretId",
					value: string,
					component: typeof secret,
					onSettled: () => void,
				) => Promise<void>;
			}
		).handleSecretSelection.bind(tab);

		const older = handle("openAISecretId", "shared-a", secret, vi.fn());
		await Promise.resolve();
		const newer = handle("openAISecretId", "shared-b", secret, vi.fn());
		firstSave.resolve();
		await older;
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(2);
		secondSave.reject(new Error("second save failed"));
		await newer;

		expect(plugin.settings.openAISecretId).toBe("podnotes-openai-api-key-2");
		expect(disk).toBe("podnotes-openai-api-key-2");
		expect(ui).toBe("podnotes-openai-api-key-2");
		expect(secret.setValue).toHaveBeenCalledTimes(1);
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(3);
	});

	it("keeps a newer secret selection and store update after a failing import", async () => {
		const firstWrite = deferred();
		const previousSecretId = "podnotes-openai-api-key";
		const importedSecretId = "podnotes-openai-api-key-2";
		const newerSecretId = "podnotes-openai-api-key-3";
		const newerProgress = {
			"Podcast::Episode": {
				title: "Episode",
				podcastName: "Podcast",
				time: 12,
				duration: 30,
				finished: false,
			},
		};
		let disk = {
			...structuredClone(DEFAULT_SETTINGS),
			schemaVersion: 2,
			openAISecretId: previousSecretId,
		};
		let saveCall = 0;
		const saveData = vi.fn((snapshot: unknown) => {
			saveCall++;
			if (saveCall === 1) {
				return firstWrite.promise.then(() => {
					disk = structuredClone(snapshot) as typeof disk;
				});
			}
			disk = structuredClone(snapshot) as typeof disk;
			return Promise.resolve();
		});
		const plugin = Object.create(PodNotes.prototype) as PodNotes;
		Object.assign(plugin, {
			settings: structuredClone(disk),
			credentials: {
				storeValues: vi.fn(() => ({ openAISecretId: importedSecretId })),
				adoptReference: vi.fn(() => newerSecretId),
			},
			isReady: true,
			persistenceUnknownFields: {},
			app: {
				vault: {
					adapter: {
						exists: vi.fn().mockResolvedValue(true),
						read: vi.fn(async () => dataFileText(disk)),
					},
				},
			},
			manifest: { dir: ".obsidian/plugins/podnotes" },
			loadData: vi.fn(async () => structuredClone(disk)),
			saveData,
		});
		attachDataFileWriter(plugin);
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(tab, "update").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		let ui = "shared-newer";
		const secret = {
			setValue: vi.fn((value: string) => {
				ui = value;
				return secret;
			}),
		};
		const applyImport = (
			tab as unknown as {
				applyImportedSettings: (
					imported: Partial<typeof DEFAULT_SETTINGS>,
					secrets: { openAI?: string },
				) => Promise<void>;
			}
		).applyImportedSettings.bind(tab);
		const selectSecret = (
			tab as unknown as {
				handleSecretSelection: (
					key: "openAISecretId",
					value: string,
					component: typeof secret,
					onSettled: () => void,
				) => Promise<void>;
			}
		).handleSecretSelection.bind(tab);

		const importing = applyImport({ defaultVolume: 0.4 }, { openAI: "imported" });
		await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));

		plugin.settings.playedEpisodes = newerProgress;
		const savingProgress = plugin.saveSettings().then(() => plugin.flushSaves());
		const selecting = selectSecret("openAISecretId", "shared-newer", secret, vi.fn());
		await Promise.resolve();

		firstWrite.reject(new Error("first import write failed"));
		await Promise.all([importing, savingProgress, selecting]);

		expect(plugin.settings.openAISecretId).toBe(newerSecretId);
		expect(plugin.settings.defaultVolume).toBe(DEFAULT_SETTINGS.defaultVolume);
		expect(plugin.settings.playedEpisodes).toEqual(newerProgress);
		expect(disk.openAISecretId).toBe(newerSecretId);
		expect(disk.defaultVolume).toBe(DEFAULT_SETTINGS.defaultVolume);
		expect(disk.playedEpisodes).toEqual(newerProgress);
		expect(ui).toBe(newerSecretId);
	});

	it("keeps an ABA hide-played store update when the matching import fails", async () => {
		const firstWrite = deferred();
		let disk = { ...structuredClone(DEFAULT_SETTINGS), schemaVersion: 2 };
		let saveCall = 0;
		const saveData = vi.fn((snapshot: unknown) => {
			saveCall++;
			if (saveCall === 1) {
				return firstWrite.promise.then(() => {
					disk = structuredClone(snapshot) as typeof disk;
				});
			}
			disk = structuredClone(snapshot) as typeof disk;
			return Promise.resolve();
		});
		const plugin = Object.create(PodNotes.prototype) as PodNotes;
		Object.assign(plugin, {
			settings: structuredClone(DEFAULT_SETTINGS),
			credentials: { storeValues: vi.fn(() => ({})) },
			isReady: false,
			persistenceUnknownFields: {},
			app: {
				vault: {
					adapter: {
						exists: vi.fn().mockResolvedValue(true),
						read: vi.fn(async () => dataFileText(disk)),
					},
				},
			},
			manifest: { dir: ".obsidian/plugins/podnotes" },
			loadData: vi.fn(async () => structuredClone(disk)),
			saveData,
		});
		attachDataFileWriter(plugin);
		hidePlayedEpisodes.set(false);
		volume.set(DEFAULT_SETTINGS.defaultVolume);
		episodeListLimit.set(DEFAULT_SETTINGS.episodeListLimit);
		playbackRate.set(DEFAULT_SETTINGS.defaultPlaybackRate);
		const unsubscribe = bindStoresToSettings(plugin);
		Object.assign(plugin, { isReady: true });
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(tab, "update").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		try {
			const importing = (
				tab as unknown as {
					applyImportedSettings: (
						imported: Partial<typeof DEFAULT_SETTINGS>,
					) => Promise<void>;
				}
			).applyImportedSettings({
				hidePlayedEpisodes: true,
				defaultVolume: 0.4,
				episodeListLimit: 20,
				defaultPlaybackRate: 1.8,
			});
			await vi.waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));

			hidePlayedEpisodes.set(true);
			volume.set(0.4);
			episodeListLimit.set(20);
			// Current playback speed is runtime state, not the persisted default.
			playbackRate.set(2.5);
			firstWrite.reject(new Error("first import write failed"));
			await importing;

			expect(get(hidePlayedEpisodes)).toBe(true);
			expect(plugin.settings.hidePlayedEpisodes).toBe(true);
			expect(disk.hidePlayedEpisodes).toBe(true);
			expect(plugin.settings.defaultVolume).toBe(0.4);
			expect(disk.defaultVolume).toBe(0.4);
			expect(plugin.settings.episodeListLimit).toBe(20);
			expect(disk.episodeListLimit).toBe(20);
			expect(get(playbackRate)).toBe(2.5);
			expect(plugin.settings.defaultPlaybackRate).toBe(DEFAULT_SETTINGS.defaultPlaybackRate);
			expect(disk.defaultPlaybackRate).toBe(DEFAULT_SETTINGS.defaultPlaybackRate);
		} finally {
			unsubscribe();
			hidePlayedEpisodes.set(false);
			volume.set(DEFAULT_SETTINGS.defaultVolume);
			episodeListLimit.set(DEFAULT_SETTINGS.episodeListLimit);
			playbackRate.set(DEFAULT_SETTINGS.defaultPlaybackRate);
		}
	});

	describe("with a podcast another device synced into data.json", () => {
		const feed = (title: string) => ({
			title,
			url: `https://example.com/${title}.xml`,
			artworkUrl: "",
		});

		function setup(saveData: (snapshot: unknown) => Promise<void>) {
			let disk: Record<string, unknown> = structuredClone({
				...DEFAULT_SETTINGS,
				schemaVersion: 2,
				savedFeeds: { Before: feed("Before") },
			});
			const plugin = Object.create(PodNotes.prototype) as PodNotes;
			Object.assign(plugin, {
				settings: structuredClone(disk),
				credentials: { storeValues: vi.fn(() => ({})) },
				isReady: true,
				persistenceUnknownFields: {},
				app: {
					vault: {
						adapter: {
							exists: vi.fn().mockResolvedValue(true),
							read: vi.fn(async () => dataFileText(disk)),
						},
					},
				},
				manifest: { dir: ".obsidian/plugins/podnotes" },
				loadData: vi.fn(async () => structuredClone(disk)),
				saveData: async (snapshot: Record<string, unknown>) => {
					await saveData(snapshot);
					disk = structuredClone(snapshot);
				},
			});
			attachDataFileWriter(plugin);
			savedFeeds.set(plugin.settings.savedFeeds);
			const unbind = bindStoresToSettings(plugin);
			disk.savedFeeds = { Before: feed("Before"), Remote: feed("Remote") };
			const tab = new PodNotesSettingsTab({} as App, plugin);
			vi.spyOn(tab, "update").mockImplementation(() => {});
			vi.spyOn(console, "error").mockImplementation(() => undefined);
			const applyImport = (
				tab as unknown as {
					applyImportedSettings: (
						imported: Partial<typeof DEFAULT_SETTINGS>,
					) => Promise<void>;
				}
			).applyImportedSettings.bind(tab);
			return { plugin, unbind, applyImport, disk: () => disk };
		}

		it("keeps that podcast through a successful import", async () => {
			const { plugin, unbind, applyImport, disk } = setup(async () => {});
			try {
				await applyImport({ timestamp: { template: "- {{time}} ", offset: 5 } });

				expect(Object.keys(disk().savedFeeds as object)).toEqual(["Before", "Remote"]);
				expect(Object.keys(plugin.settings.savedFeeds)).toEqual(["Before", "Remote"]);
				expect((disk().timestamp as { offset: number }).offset).toBe(5);
			} finally {
				unbind();
			}
		});

		it("rolls a failed import back to the podcasts it replaced, keeping the synced one", async () => {
			let calls = 0;
			const { plugin, unbind, applyImport, disk } = setup(async () => {
				if (++calls === 1) throw new Error("first import write failed");
			});
			try {
				await applyImport({ savedFeeds: { Imported: feed("Imported") } });

				expect(Object.keys(disk().savedFeeds as object)).toEqual(["Before", "Remote"]);
				expect(Object.keys(plugin.settings.savedFeeds)).toEqual(["Before", "Remote"]);
			} finally {
				unbind();
			}
		});
	});

	it("ordinary settings export never resolves or serializes SecretStorage values", async () => {
		const create = vi.fn().mockResolvedValue(undefined);
		const exportValues = vi.fn(() => ({ openAI: "must-not-be-read" }));
		const app = {
			vault: {
				getAbstractFileByPath: vi.fn(() => null),
				create,
			},
		} as unknown as App;
		const plugin = {
			settings: {
				...structuredClone(DEFAULT_SETTINGS),
				openAISecretId: "podnotes-openai-api-key",
			},
			credentials: { exportValues },
			manifest: { version: "2.17.3" },
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab(app, plugin);

		await (
			tab as unknown as {
				handleSettingsExport: (fileName: string, includeSecret: boolean) => Promise<void>;
			}
		).handleSettingsExport("settings.json", false);

		expect(exportValues).not.toHaveBeenCalled();
		expect(create).toHaveBeenCalledTimes(1);
		const serialized = create.mock.calls[0][1] as string;
		expect(serialized).not.toContain("must-not-be-read");
		expect(serialized).not.toContain("openAISecretId");
		expect(JSON.parse(serialized)).not.toHaveProperty("secrets");
	});
});
