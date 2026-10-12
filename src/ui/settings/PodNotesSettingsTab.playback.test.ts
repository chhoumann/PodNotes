// @vitest-environment jsdom
import { get } from "svelte/store";
import { expect, test, vi } from "vitest";
import type { App } from "obsidian";

import { DEFAULT_SETTINGS } from "src/constants";
import type PodNotes from "src/main";
import { PlayerController } from "src/player/PlayerController";
import { PodNotesSettingsTab } from "./PodNotesSettingsTab";
import { FakeDocument } from "../../../tests/mocks/fakeMedia";

test("the Default Volume slider sets the playing volume and saves it", () => {
	const doc = new FakeDocument();
	const plugin = {
		settings: structuredClone(DEFAULT_SETTINGS),
		app: { vault: {} },
		saveSettings: vi.fn().mockResolvedValue(undefined),
	} as unknown as PodNotes;
	plugin.player = new PlayerController(doc.asPlayerDocument(), plugin);
	plugin.player.play({
		title: "A",
		streamUrl: "https://pod.example.com/A.mp3",
		url: "",
		description: "",
		content: "",
		podcastName: "Show",
	});
	const container = document.createElement("div");
	(
		new PodNotesSettingsTab({} as App, plugin) as unknown as {
			addDefaultVolumeSetting: (container: HTMLElement) => void;
		}
	).addDefaultVolumeSetting(container);
	const slider = container.querySelector("input") as HTMLInputElement;

	slider.value = "0.25";
	slider.dispatchEvent(new Event("input"));

	expect(doc.media.volume).toBe(0.25);
	expect(get(plugin.player.state).volume).toBe(0.25);
	expect(plugin.settings.defaultVolume).toBe(0.25);
	expect(plugin.saveSettings).toHaveBeenCalled();
});
