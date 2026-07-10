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
});
