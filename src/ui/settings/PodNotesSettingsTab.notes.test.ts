// @vitest-environment jsdom
import { derived, readable } from "svelte/store";
import { afterEach, expect, test } from "vitest";
import { App } from "obsidian";
import { DEFAULT_SETTINGS } from "src/constants";
import type PodNotes from "src/main";
import { plugin as pluginStore } from "src/store";
import { PodNotesSettingsTab } from "./PodNotesSettingsTab";

let stop = () => {};
afterEach(() => {
	stop();
	pluginStore.set(undefined as never);
});

test("the note path field tells an open view the new path", () => {
	const plugin = {
		settings: structuredClone(DEFAULT_SETTINGS),
		api: {},
		feeds: readable(new Map()),
		saveSettings: () => Promise.resolve(),
	} as unknown as PodNotes;
	pluginStore.set(plugin);
	const paths: string[] = [];
	stop = derived(pluginStore, ($plugin) => $plugin.settings.note.path).subscribe((path) =>
		paths.push(path),
	);
	const container = document.createElement("div");
	(
		new PodNotesSettingsTab(new App(), plugin) as unknown as {
			addNoteSettings(container: HTMLElement): void;
		}
	).addNoteSettings(container);
	const field = [...container.querySelectorAll("div")]
		.find((setting) => setting.firstElementChild?.textContent === "Note creation file path")
		?.querySelector("input");

	field!.value = "Elsewhere/{{title}}.md";
	field!.dispatchEvent(new Event("input"));

	expect(paths).toEqual([DEFAULT_SETTINGS.note.path, "Elsewhere/{{title}}.md"]);
});
