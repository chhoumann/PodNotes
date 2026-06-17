import { get } from "svelte/store";
import { describe, expect, it, vi } from "vitest";
import type { App } from "obsidian";

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
		expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
	});
});
