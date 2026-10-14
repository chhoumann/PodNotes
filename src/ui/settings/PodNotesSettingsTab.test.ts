// @vitest-environment jsdom
import { derived, readable } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as obsidian from "obsidian";

import { DEFAULT_SETTINGS } from "src/constants";
import PodNotes from "src/main";
import { decodePodNotesData } from "src/persistence/podNotesData";
import { PlayerController } from "src/player/PlayerController";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { plugin as pluginStore } from "src/store";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { PodNotesSettingsTab } from "./PodNotesSettingsTab";
import { attachDataFileWriter, dataFileText } from "../../../tests/mocks/dataFileWriter";
import { FakeDocument } from "../../../tests/mocks/fakeMedia";

const openTabs = new Set<PodNotesSettingsTab>();

/** Obsidian closing Settings: the rows' cleanups, then hide(). The mock tab does it. */
function close(tab: PodNotesSettingsTab): void {
	(tab as unknown as { close(): void }).close();
}

afterEach(() => {
	for (const tab of openTabs) {
		close(tab);
		tab.containerEl.remove();
	}
	openTabs.clear();
	vi.restoreAllMocks();
	pluginStore.set(undefined as never);
});

/** The tab of a plugin whose saves go through the real writer to a counted data.json. */
function open(saved: Partial<IPodNotesSettings> = {}) {
	const settings = { ...structuredClone(DEFAULT_SETTINGS), ...structuredClone(saved) };
	let disk: Record<string, unknown> = { ...structuredClone(settings), schemaVersion: 2 };
	let writes = 0;
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin, {
		settings,
		api: {},
		feeds: readable(new Map()),
		credentials: {
			storeValues: vi.fn(() => ({})),
			status: () => "unset",
			exportValues: vi.fn(() => ({ openAI: "sk-device" })),
		},
		feedUrls: new FeedUrlRepository(new obsidian.SecretStorage()),
		isReady: true,
		persistenceUnknownFields: {},
		manifest: { dir: ".obsidian/plugins/podnotes", version: "3.0.0" },
		app: {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(true),
					read: vi.fn(async () => dataFileText(disk)),
				},
				getAbstractFileByPath: () => null,
				create: vi.fn().mockResolvedValue(undefined),
			},
		},
		loadData: vi.fn(async () => structuredClone(disk)),
		saveData: async (snapshot: Record<string, unknown>) => {
			writes++;
			disk = structuredClone(snapshot);
		},
	});
	attachDataFileWriter(plugin);
	plugin.player = new PlayerController(new FakeDocument().asPlayerDocument(), plugin);
	pluginStore.set(plugin);
	const tab = new PodNotesSettingsTab(plugin.app as never, plugin);
	tab.display();
	document.body.append(tab.containerEl);
	openTabs.add(tab);

	const row = (name: string) => {
		const found = [...tab.containerEl.querySelectorAll(".setting-item")].find(
			(setting) => setting.querySelector(".setting-item-name")?.textContent === name,
		);
		if (!(found instanceof HTMLElement)) throw new Error(`No row named ${name}`);
		return found;
	};
	const control = <T extends Element>(name: string, selector: string) =>
		row(name).querySelector(".setting-item-control")!.querySelector(selector) as T;
	return {
		plugin,
		tab,
		row,
		field: (name: string) =>
			control<HTMLInputElement | HTMLTextAreaElement>(name, "input, textarea"),
		select: (name: string) => control<HTMLSelectElement>(name, "select"),
		toggle: (name: string) => control<HTMLInputElement>(name, "input[type=checkbox]"),
		/** A change synced in from another device. */
		sync: async (change: Partial<IPodNotesSettings>) => {
			disk = { ...disk, ...structuredClone(change) };
			await plugin.onExternalSettingsChange();
		},
		/** data.json writes, once every save asked for has run. */
		writes: async () => {
			await plugin.flushSaves();
			return writes;
		},
		disk: async () => {
			await plugin.flushSaves();
			return disk as unknown as IPodNotesSettings;
		},
	};
}

function type(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
	for (const character of text) {
		field.value += character;
		field.dispatchEvent(new Event("input"));
	}
}

function retype(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
	enter(field, "");
	type(field, text);
}

/** Pastes `text` over the field, as a number field needs: it drops a lone "-". */
function enter(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
	field.value = text;
	field.dispatchEvent(new Event("input"));
}

const complete = (field: Element) => field.dispatchEvent(new Event("change"));

function choose(select: HTMLSelectElement, value: string): void {
	select.value = value;
	select.dispatchEvent(new Event("change"));
}

describe("sections", () => {
	test("each SPEC section lists its own rows, in order, and nothing removed", () => {
		const { tab } = open();

		expect(
			tab
				.getSettingDefinitions()
				.map(({ heading, items }) => [
					heading,
					items?.map((item) => ("name" in item ? item.name : "")),
				]),
		).toEqual([
			[
				"Playback",
				[
					"Skip back (s)",
					"Skip forward (s)",
					"Default speed",
					"Queue episodes I switch away from",
				],
			],
			["Headset and lock screen", ["Previous track", "Next track"]],
			[
				"Notes",
				[
					"Timestamp template",
					"Timestamp offset (s)",
					"Episode note path",
					"Episode note template",
					"Podcast note path",
					"Podcast note template",
				],
			],
			[
				"Transcripts",
				[
					"OpenAI API key",
					"Transcript path",
					"Transcript template",
					"Speaker diarization",
					"Diarization provider",
					"Deepgram API key",
					"Speaker label format",
				],
			],
			["Downloads", ["Download path"]],
			["Library", ["Import OPML", "Export OPML", "Latest episodes per podcast"]],
			["Import and export", ["Import settings", "Include API keys", "Export settings"]],
		]);
	});

	test("each row renders under its own name, and the speaker rows apply only with diarization", () => {
		const { row, toggle, select } = open();
		const disabled = (name: string) => row(name).classList.contains("is-disabled");

		expect(
			["Diarization provider", "Deepgram API key", "Speaker label format"].map(disabled),
		).toEqual([true, true, true]);

		toggle("Speaker diarization").click();
		expect(
			["Diarization provider", "Deepgram API key", "Speaker label format"].map(disabled),
		).toEqual([false, true, false]);

		choose(select("Diarization provider"), "deepgram");
		expect(disabled("Deepgram API key")).toBe(false);
	});
});

describe("text fields", () => {
	test("typing saves nothing; the completed edit saves once and tells an open view", async () => {
		const { plugin, field, writes, disk } = open();
		const paths: string[] = [];
		const stop = derived(pluginStore, ($plugin) => $plugin.settings.note.path).subscribe(
			(path) => paths.push(path),
		);
		const path = field("Episode note path");

		retype(path, "UI3/My podcast note.md");
		expect(await writes()).toBe(0);
		expect(plugin.settings.note.path).toBe(DEFAULT_SETTINGS.note.path);

		complete(path);
		expect(await writes()).toBe(1);
		expect((await disk()).note.path).toBe("UI3/My podcast note.md");
		stop();
		expect(paths).toEqual([DEFAULT_SETTINGS.note.path, "UI3/My podcast note.md"]);
	});

	test("an edit in progress saves once when Settings closes", async () => {
		const { tab, field, writes, disk } = open();

		type(field("Timestamp template"), "at ");
		close(tab);

		expect(await writes()).toBe(1);
		expect((await disk()).timestamp.template).toBe(`${DEFAULT_SETTINGS.timestamp.template}at `);
	});

	test("an edit in progress saves once when its window unloads without closing the rows", async () => {
		const { tab, field, writes, disk } = open();

		type(field("Transcript path"), "x");
		window.dispatchEvent(new Event("pagehide"));

		expect(await writes()).toBe(1);
		expect((await disk()).transcript.path).toBe(`${DEFAULT_SETTINGS.transcript.path}x`);
		tab.hide();
		expect(await writes()).toBe(1);
	});

	test("an edit in progress saves once when the app goes to the background", async () => {
		const { field, writes, disk } = open();
		const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

		type(field("Download path"), "/x");
		document.dispatchEvent(new Event("visibilitychange"));

		expect(await writes()).toBe(1);
		expect((await disk()).download.path).toBe(`${DEFAULT_SETTINGS.download.path}/x`);
		visibility.mockReturnValue("visible");
		complete(field("Download path"));
		expect(await writes()).toBe(1);
	});

	test("a field nobody edited never puts back the value it showed", async () => {
		const { plugin, tab, sync, writes, disk } = open();

		await sync({ note: { ...DEFAULT_SETTINGS.note, path: "Synced/{{title}}.md" } });
		close(tab);

		expect(await writes()).toBe(0);
		expect(plugin.settings.note.path).toBe("Synced/{{title}}.md");
		expect((await disk()).note.path).toBe("Synced/{{title}}.md");
	});

	test("an import wins over an edit in progress to the same field", async () => {
		const { tab, field, disk } = open();

		type(field("Episode note path"), "mine");
		await (
			tab as unknown as {
				applyImportedSettings(imported: Partial<IPodNotesSettings>): Promise<void>;
			}
		).applyImportedSettings({
			note: { path: "Imported/{{title}}.md", template: "# {{title}}" },
		});

		expect((await disk()).note).toEqual({
			path: "Imported/{{title}}.md",
			template: "# {{title}}",
		});
		expect(field("Episode note path").value).toBe("Imported/{{title}}.md");
	});

	test("a number field keeps the saved value for an entry it cannot use", async () => {
		const { plugin, field, writes } = open();
		const skip = field("Skip back (s)");

		for (const entry of ["", "0", "-5"]) {
			enter(skip, entry);
			complete(skip);
		}
		expect(skip.value).toBe("15");
		expect(await writes()).toBe(0);

		enter(skip, "42");
		complete(skip);
		expect(plugin.settings.skipBackwardLength).toBe(42);
		expect(await writes()).toBe(1);
	});

	test("a download path without {{title}} warns until it has one", () => {
		const { row, field } = open();
		const path = field("Download path");
		const warning = () =>
			row("Download path").querySelector(".setting-item-error")?.textContent;

		retype(path, "PodNotes/{{podcast}}");
		expect(warning()).toBe(
			"Without {{title}}, episodes share one file and downloads overwrite each other. Add it, for example PodNotes/{{podcast}}/{{title}}.",
		);
		type(path, "/{{title}}");
		expect(warning()).toBeUndefined();
	});
});

describe("Default speed", () => {
	const options = (select: HTMLSelectElement) =>
		[...select.options].map((option) => option.textContent);

	test("offers the player's speeds and saves the one chosen, quarter steps included", async () => {
		const { select, writes, disk } = open();
		const speed = select("Default speed");

		expect(options(speed)).toEqual(["0.75×", "1×", "1.25×", "1.5×", "1.75×", "2×"]);
		expect(speed.value).toBe("1");

		choose(speed, "1.25");

		expect(await writes()).toBe(1);
		const saved = await disk();
		expect(saved.defaultPlaybackRate).toBe(1.25);
		expect(decodePodNotesData(saved).settings.defaultPlaybackRate).toBe(1.25);
	});

	test("shows a saved speed the player does not offer, without saving it", async () => {
		const { select, writes } = open({ defaultPlaybackRate: 1.3 });
		const speed = select("Default speed");

		expect(options(speed)).toEqual(["0.75×", "1×", "1.25×", "1.3×", "1.5×", "1.75×", "2×"]);
		expect(speed.value).toBe("1.3");
		expect(await writes()).toBe(0);
	});
});

describe("Headset and lock screen", () => {
	test("offers each button's actions and saves the one chosen", async () => {
		const { plugin, select, writes } = open();
		const labels = (name: string) =>
			[...select(name).options].map((option) => [option.value, option.textContent]);

		expect(labels("Previous track")).toEqual([
			["captureTimestamp", "Capture timestamp"],
			["skipBackward", "Back by the skip length"],
			["previousChapter", "Previous chapter"],
		]);
		expect(labels("Next track")).toEqual([
			["skipForward", "Forward by the skip length"],
			["nextInQueue", "Next in queue"],
			["nextChapter", "Next chapter"],
			["captureTimestamp", "Capture timestamp"],
		]);
		expect([select("Previous track").value, select("Next track").value]).toEqual([
			"captureTimestamp",
			"skipForward",
		]);

		choose(select("Next track"), "nextChapter");

		expect(plugin.settings.headsetNextTrack).toBe("nextChapter");
		expect(await writes()).toBe(1);
	});
});

describe("Queue episodes I switch away from", () => {
	test("follows a change made on the Queue page while Settings is open, until it closes", async () => {
		const { plugin, tab, toggle, writes } = open();
		const queueToggle = toggle("Queue episodes I switch away from");
		expect(queueToggle.checked).toBe(true);

		plugin.setAutoQueue(false);
		expect(queueToggle.checked).toBe(false);
		expect(await writes()).toBe(1);

		queueToggle.click();
		expect(plugin.settings.autoQueue).toBe(true);
		expect(await writes()).toBe(2);

		close(tab);
		plugin.setAutoQueue(false);
		expect(queueToggle.checked).toBe(true);
	});
});

describe("Import and export", () => {
	test("Include API keys starts off each time Settings opens", async () => {
		const { plugin, tab, toggle, field, row } = open();

		toggle("Include API keys").click();
		close(tab);
		tab.display();
		expect(toggle("Include API keys").checked).toBe(false);

		retype(field("Export settings"), "Backup");
		row("Export settings").querySelector("button")!.click();

		await vi.waitFor(() => expect(plugin.app.vault.create).toHaveBeenCalled());
		expect(plugin.credentials.exportValues).not.toHaveBeenCalled();
		const [fileName, contents] = vi.mocked(plugin.app.vault.create).mock.calls[0];
		expect(fileName).toBe("Backup.json");
		expect(JSON.parse(contents as string)).not.toHaveProperty("secrets");
	});
});
