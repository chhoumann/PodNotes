// @vitest-environment jsdom
import { derived, get, readable } from "svelte/store";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as obsidian from "obsidian";

import { DEFAULT_SETTINGS } from "src/constants";
import { API } from "src/API/API";
import PodNotes from "src/main";
import { decodePodNotesData } from "src/persistence/podNotesData";
import { PlayerController } from "src/player/PlayerController";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { episodeListLimit, plugin as pluginStore } from "src/store";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { PodNotesSettingsTab } from "./PodNotesSettingsTab";
import { attachDataFileWriter, dataFileText } from "../../../tests/mocks/dataFileWriter";
import { FakeDocument } from "../../../tests/mocks/fakeMedia";

const openTabs = new Set<PodNotesSettingsTab>();

function close(tab: PodNotesSettingsTab): void {
	(tab as unknown as { close(): void }).close();
}

afterEach(() => {
	for (const tab of openTabs) {
		close(tab);
		tab.containerEl.remove();
	}
	openTabs.clear();
	vi.useRealTimers();
	vi.restoreAllMocks();
	pluginStore.set(undefined as never);
});

/** The typing pause runs on fake time. Saves settle on real time. */
const fakeTypingTime = () => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

/** Lets the saves already asked for finish without asking for one. */
const settled = () => new Promise((resolve) => setImmediate(resolve));

function open(saved: Partial<IPodNotesSettings> = {}) {
	const settings = { ...structuredClone(DEFAULT_SETTINGS), ...structuredClone(saved) };
	let disk: Record<string, unknown> = { ...structuredClone(settings), schemaVersion: 2 };
	let writes = 0;
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin, {
		settings,
		api: new API(),
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
			secretStorage: new obsidian.SecretStorage(),
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
		sync: async (change: Partial<IPodNotesSettings>) => {
			disk = { ...disk, ...structuredClone(change) };
			await plugin.onExternalSettingsChange();
		},
		writes: async () => {
			await settled();
			return writes;
		},
		disk: async () => {
			await settled();
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

const pressEnter = (field: Element) =>
	field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));

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

	test("each field is named after its row where it takes focus, without an aria-label Obsidian would show as a tooltip", () => {
		const { tab } = open();
		const fields = [
			...tab.containerEl.querySelectorAll(
				'.setting-item-control :is(input:not([tabindex="-1"]), select, textarea, [tabindex="0"], .setting-secret-value + button)',
			),
		];
		const rowOf = (field: Element) =>
			field.closest(".setting-item")?.querySelector(".setting-item-name")?.textContent;

		expect(fields.map(rowOf)).toEqual([
			"Skip back (s)",
			"Skip forward (s)",
			"Default speed",
			"Queue episodes I switch away from",
			"Previous track",
			"Next track",
			"Timestamp template",
			"Timestamp offset (s)",
			"Episode note path",
			"Episode note template",
			"Podcast note path",
			"Podcast note template",
			"OpenAI API key",
			"Transcript path",
			"Transcript template",
			"Speaker diarization",
			"Diarization provider",
			"Deepgram API key",
			"Speaker label format",
			"Download path",
			"Export OPML",
			"Latest episodes per podcast",
			"Include API keys",
			"Export settings",
		]);
		for (const field of fields) {
			expect(field).toHaveAccessibleName(
				field.matches("button") ? `Link... ${rowOf(field)}` : rowOf(field),
			);
			expect(field).not.toHaveAttribute("aria-label");
		}
	});

	test("an API key's button keeps its own words and adds its row's name", () => {
		const { plugin, tab, row } = open({ openAISecretId: "podnotes-openai-api-key" });
		plugin.app.secretStorage.setSecret("podnotes-openai-api-key", "sk-test");
		tab.display();

		expect(row("OpenAI API key").querySelector("button")).toHaveAccessibleName(
			"Change OpenAI API key",
		);
		expect(row("Deepgram API key").querySelector("button")).toHaveAccessibleName(
			"Link... Deepgram API key",
		);
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
	test("the timestamp preview follows a completed offset change", () => {
		const { plugin, tab, row, field } = open();
		plugin.player.restore({
			title: "Episode",
			podcastName: "Show",
			streamUrl: "https://example.com/audio.mp3",
			url: "",
			description: "",
			content: "",
		});
		plugin.player.seek(95);
		tab.update();
		enter(field("Timestamp template"), "{{time}}");
		complete(field("Timestamp template"));
		const preview = () =>
			row("Timestamp template").querySelector(".setting-item-description")?.textContent;
		expect(preview()).toBe("00:01:35");

		enter(field("Timestamp offset (s)"), "3");
		complete(field("Timestamp offset (s)"));

		expect(preview()).toBe("00:01:32");
	});

	test("each keystroke applies at once; the save waits for 500 ms without one and tells an open view", async () => {
		fakeTypingTime();
		const { plugin, field, writes, disk } = open();
		const paths: string[] = [];
		const stop = derived(pluginStore, ($plugin) => $plugin.settings.note.path).subscribe(
			(path) => paths.push(path),
		);
		const path = field("Episode note path");

		try {
			enter(path, "");
			for (const character of "UI3/My podcast note.md") {
				vi.advanceTimersByTime(499);
				type(path, character);
				expect(plugin.settings.note.path).toBe(path.value);
			}
			vi.advanceTimersByTime(499);
			expect(await writes()).toBe(0);

			vi.advanceTimersByTime(1);
			expect(await writes()).toBe(1);
			expect((await disk()).note.path).toBe("UI3/My podcast note.md");

			complete(path);
			expect(await writes()).toBe(1);
			expect(paths).toEqual([DEFAULT_SETTINGS.note.path, "UI3/My podcast note.md"]);
		} finally {
			stop();
		}
	});

	test("completing an edit saves it at once and drops its pending save", async () => {
		fakeTypingTime();
		const { plugin, field, writes, disk } = open();
		const template = field("Episode note template");

		type(template, "\nmore");
		expect(plugin.settings.note.template).toBe(`${DEFAULT_SETTINGS.note.template}\nmore`);
		complete(template);

		expect(await writes()).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(1_000);
		expect(await writes()).toBe(1);
		expect((await disk()).note.template).toBe(`${DEFAULT_SETTINGS.note.template}\nmore`);
	});

	test("blur saves a return to the original text even without a change event", async () => {
		fakeTypingTime();
		const { field, writes, disk } = open();
		const path = field("Episode note path");
		type(path, "x");
		vi.advanceTimersByTime(500);
		expect(await writes()).toBe(1);

		enter(path, DEFAULT_SETTINGS.note.path);
		path.dispatchEvent(new Event("blur"));

		expect(await writes()).toBe(2);
		expect((await disk()).note.path).toBe(DEFAULT_SETTINGS.note.path);
		vi.advanceTimersByTime(500);
		expect(await writes()).toBe(2);
	});

	test("a sync after the pause's save wins over the field when the edit completes", async () => {
		fakeTypingTime();
		const { plugin, field, sync, writes, disk } = open();
		const path = field("Episode note path");

		type(path, "x");
		vi.advanceTimersByTime(500);
		expect(await writes()).toBe(1);
		await sync({ note: { ...DEFAULT_SETTINGS.note, path: "Synced/{{title}}.md" } });
		complete(path);

		expect(await writes()).toBe(1);
		expect([plugin.settings.note.path, path.value]).toEqual([
			"Synced/{{title}}.md",
			"Synced/{{title}}.md",
		]);
		expect((await disk()).note.path).toBe("Synced/{{title}}.md");
	});

	test.each(["Episode note path", "Episode note template"])(
		"a settings refresh keeps the focused %s text and selection until completion",
		async (name) => {
			fakeTypingTime();
			const { tab, field, sync, writes, disk } = open();
			const input = field(name);
			input.focus();
			enter(input, "Local");
			input.setSelectionRange(1, 4);
			vi.advanceTimersByTime(500);
			expect(await writes()).toBe(1);

			await sync({ note: { path: "Remote path", template: "Remote template" } });
			tab.update();

			expect(field(name).value).toBe("Local");
			expect([field(name).selectionStart, field(name).selectionEnd]).toEqual([1, 4]);
			complete(field(name));
			expect(field(name).value).toBe(
				name === "Episode note path" ? "Remote path" : "Remote template",
			);
			expect((await disk()).note).toEqual({
				path: "Remote path",
				template: "Remote template",
			});
			expect(await writes()).toBe(1);
		},
	);

	test.each(["Episode note path", "Episode note template"])(
		"typing in %s after a synced refresh saves the new edit on completion",
		async (name) => {
			fakeTypingTime();
			const { tab, field, sync, writes, disk } = open();
			field(name).focus();
			enter(field(name), "Local");
			vi.advanceTimersByTime(500);
			expect(await writes()).toBe(1);
			await sync({ note: { path: "Remote path", template: "Remote template" } });
			tab.update();

			enter(field(name), "Continued");
			if (name === "Episode note path") pressEnter(field(name));
			else field(name).dispatchEvent(new Event("blur"));

			expect(await writes()).toBe(2);
			expect((await disk()).note).toEqual(
				name === "Episode note path"
					? { path: "Continued", template: "Remote template" }
					: { path: "Remote path", template: "Continued" },
			);
		},
	);

	test("Enter completes a one-line edit; in a template it is a new line", async () => {
		fakeTypingTime();
		const { field, writes, disk } = open();
		const path = field("Episode note path");
		const template = field("Episode note template");

		type(path, "x");
		pressEnter(path);
		expect(await writes()).toBe(1);
		expect((await disk()).note.path).toBe(`${DEFAULT_SETTINGS.note.path}x`);

		type(template, "\n");
		pressEnter(template);
		expect(await writes()).toBe(1);
		vi.advanceTimersByTime(500);
		expect(await writes()).toBe(2);
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

	test("diarization controls stay locked during import and unlock with the imported applicability", async () => {
		const { plugin, tab, select } = open({
			transcript: {
				...DEFAULT_SETTINGS.transcript,
				diarization: { ...DEFAULT_SETTINGS.transcript.diarization, enabled: true },
			},
		});
		let release!: () => void;
		vi.spyOn(plugin, "saveSettingsStrict")
			.mockImplementationOnce(
				() =>
					new Promise<void>((resolve) => {
						release = resolve;
					}),
			)
			.mockResolvedValue(undefined);
		const importing = (
			tab as unknown as {
				applyImportedSettings(imported: Partial<IPodNotesSettings>): Promise<void>;
			}
		).applyImportedSettings({ defaultPlaybackRate: 1.25 });
		await Promise.resolve();
		expect(select("Diarization provider").disabled).toBe(true);

		plugin.setAutoQueue(!plugin.settings.autoQueue);
		const disabledDuringImport = select("Diarization provider").disabled;
		release();
		await importing;

		expect(disabledDuringImport).toBe(true);
		expect(select("Diarization provider").disabled).toBe(false);
	});

	test("a number field applies a usable entry as typed and shows the saved value for one it cannot use once the edit completes", async () => {
		fakeTypingTime();
		const { plugin, field, writes } = open();
		const skip = field("Skip back (s)");

		for (const entry of ["", "0", "-5"]) {
			enter(skip, entry);
			vi.advanceTimersByTime(500);
			expect([skip.value, plugin.settings.skipBackwardLength]).toEqual([entry, 15]);
			pressEnter(skip);
			expect(skip.value).toBe("15");
		}
		expect(await writes()).toBe(0);

		enter(skip, "4");
		expect(plugin.settings.skipBackwardLength).toBe(4);
		enter(skip, "42");
		complete(skip);
		expect(plugin.settings.skipBackwardLength).toBe(42);
		expect(await writes()).toBe(1);
	});

	test("the episode limit reaches the lists as typed and saves after the pause", async () => {
		fakeTypingTime();
		const { plugin, field, writes } = open();
		const limit = field("Latest episodes per podcast");

		enter(limit, "1");
		enter(limit, "12");
		expect([get(episodeListLimit), plugin.settings.episodeListLimit]).toEqual([12, 12]);
		expect(await writes()).toBe(0);

		vi.advanceTimersByTime(500);
		expect(await writes()).toBe(1);
	});

	test("a download path without {{title}} warns until it has one", () => {
		const { row, field } = open();
		const path = field("Download path");
		const warning = () =>
			row("Download path").querySelector(".setting-item-error")?.textContent;

		retype(path, "PodNotes/{{podcast}}");
		expect(warning()).toBe(
			"Without {{title}}, episodes share a file name and a second download to it fails. Add it, for example PodNotes/{{podcast}}/{{title}}.",
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
