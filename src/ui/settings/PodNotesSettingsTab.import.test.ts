import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";
import * as obsidian from "obsidian";

import { DEFAULT_SETTINGS } from "src/constants";
import type PodNotes from "src/main";
import { playbackRate } from "src/store";
import { PodNotesSettingsTab } from "./PodNotesSettingsTab";

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
		vi.spyOn(tab, "display").mockImplementation(() => {});

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
		const display = vi.spyOn(tab, "display").mockImplementation(() => {});
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
		expect(display).not.toHaveBeenCalled();
		expect(notice).toHaveBeenCalledWith(
			"Could not import PodNotes settings. Previous settings were kept.",
			10000,
		);
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(2);
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
			invalidateTranscriptionCredentialCache: vi.fn(),
			saveSettings: vi.fn().mockResolvedValue(undefined),
			saveSettingsStrict: vi.fn().mockResolvedValue(undefined),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(tab, "display").mockImplementation(() => {});

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
		expect(plugin.invalidateTranscriptionCredentialCache).toHaveBeenCalledOnce();
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
			openAISecretId: "previous-openai",
		};
		const plugin = {
			settings: previous,
			credentials: {
				storeValues: vi.fn(() => ({ openAISecretId: "new-openai" })),
			},
			invalidateTranscriptionCredentialCache: vi.fn(),
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
		expect(plugin.settings.openAISecretId).toBe("previous-openai");
		expect(plugin.invalidateTranscriptionCredentialCache).toHaveBeenCalledTimes(2);
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(2);
	});

	it("rolls back a SecretComponent reference when strict persistence fails", async () => {
		const plugin = {
			settings: {
				...structuredClone(DEFAULT_SETTINGS),
				openAISecretId: "previous-secret",
			},
			saveSettingsStrict: vi
				.fn()
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValueOnce(undefined),
			invalidateTranscriptionCredentialCache: vi.fn(),
		} as unknown as PodNotes;
		const tab = new PodNotesSettingsTab({} as App, plugin);
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		const saved = await (
			tab as unknown as {
				saveSecretReference: (key: "openAISecretId", value: string) => Promise<boolean>;
			}
		).saveSecretReference("openAISecretId", "new-secret");

		expect(saved).toBe(false);
		expect(plugin.settings.openAISecretId).toBe("previous-secret");
		expect(plugin.invalidateTranscriptionCredentialCache).toHaveBeenCalledTimes(2);
		expect(plugin.saveSettingsStrict).toHaveBeenCalledTimes(2);
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
