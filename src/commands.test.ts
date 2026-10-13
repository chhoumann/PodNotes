// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { MarkdownView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import PodNotes from "./main";
import { VIEW_TYPE } from "./constants";
import type { Episode } from "./types/Episode";
import { PickerModal } from "./ui/PickerModal";
import { fetchTextWithTimeout } from "./utility/networkRequest";
import { privateFeedPlaceholder } from "./utility/privateFeedUrl";
import { dataFileText } from "../tests/mocks/dataFileWriter";

vi.mock("./utility/networkRequest", async (importOriginal) => ({
	...(await importOriginal<typeof import("./utility/networkRequest")>()),
	fetchTextWithTimeout: vi.fn(),
}));

const episode: Episode = {
	title: "Saved Episode",
	streamUrl: "https://example.com/saved.mp3",
	url: "https://example.com/saved",
	description: "",
	content: "",
	podcastName: "Pod",
};
const playing = {
	schemaVersion: 2,
	currentEpisode: episode,
	playedEpisodes: {
		"Pod::Saved Episode": {
			title: "Saved Episode",
			podcastName: "Pod",
			time: 1234,
			duration: 3600,
			finished: false,
		},
	},
	timestamp: { template: "- {{time}}", offset: 0 },
	note: { path: "PodNotes/{{podcast}}/{{title}}.md", template: "# {{title}}" },
};
const NOTE_PATH = "PodNotes/Pod/Saved Episode.md";

function vaultFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.md$/, ""),
		extension: "md",
	});
}

/** Enough of CodeMirror for a capture: text, a caret, and replaceSelection. */
function fakeEditor(text: string, caret = text.length) {
	let value = text;
	let at = caret;
	const lines = () => value.split("\n");
	return {
		getValue: () => value,
		getLine: (line: number) => lines()[line] ?? "",
		lineCount: () => lines().length,
		getCursor: () => {
			const before = value.slice(0, at).split("\n");
			return { line: before.length - 1, ch: before[before.length - 1].length };
		},
		replaceSelection: (replacement: string) => {
			value = value.slice(0, at) + replacement + value.slice(at);
			at += replacement.length;
		},
	};
}

function fakeVault() {
	const notes = new Map<string, { file: TFile; content: string }>();
	return {
		notes,
		read: (path: string) => notes.get(path)?.content,
		vault: {
			on: vi.fn(() => ({})),
			getAbstractFileByPath: (path: string) => notes.get(path)?.file ?? null,
			getRoot: () => Object.assign(new TFolder(), { path: "", children: [] }),
			createFolder: async () => {},
			create: async (path: string, content: string) => {
				const file = vaultFile(path);
				notes.set(path, { file, content });
				return file;
			},
			process: async (file: TFile, change: (content: string) => string) => {
				const note = notes.get(file.path)!;
				note.content = change(note.content);
				return note.content;
			},
		},
	};
}

function fakeWorkspace() {
	const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
	const trigger = (name: string, ...args: unknown[]) => {
		for (const listener of listeners.get(name) ?? []) listener(...args);
	};
	const open: WorkspaceLeaf[] = [];
	const opened: string[] = [];
	const podNotesLeaf = { view: { getViewType: () => VIEW_TYPE } } as unknown as WorkspaceLeaf;
	const workspace = {
		activeEditor: null as MarkdownView | null,
		on: vi.fn((name: string, listener: (...args: unknown[]) => void) => {
			listeners.set(name, [...(listeners.get(name) ?? []), listener]);
			return {};
		}),
		getLeavesOfType: (type: string) => (type === "markdown" ? [...open] : []),
		getActiveViewOfType: () => null,
		getRightLeaf: () => null,
		revealLeaf: vi.fn(),
		onLayoutReady: vi.fn(),
		getLeaf: () => ({ openFile: async (file: TFile) => opened.push(file.path) }),
	};

	/** Opens a note in a tab that takes focus. Its `mode` switches it between Reading view and editing. */
	const openNote = (path: string, text: string, caret?: number, reading = false) => {
		const leaf = {} as WorkspaceLeaf;
		const editor = fakeEditor(text, caret);
		const view = Object.assign(new MarkdownView(leaf), { editor, file: vaultFile(path) });
		const mode = vi.spyOn(view, "getMode").mockReturnValue(reading ? "preview" : "source");
		leaf.view = view;
		open.push(leaf);
		workspace.activeEditor = view;
		trigger("active-leaf-change", leaf);
		return { leaf, editor, mode };
	};

	return {
		workspace,
		/** Paths of the files opened in a tab. */
		opened,
		/** Opens a note in editing mode and puts the caret in it. */
		openNote: (path: string, text: string, caret?: number) => openNote(path, text, caret),
		openInReadingView: (path: string, text: string) => openNote(path, text, undefined, true),
		/** A click in the PodNotes view: its leaf is active and no editor is. */
		focusPodNotes() {
			workspace.activeEditor = null;
			trigger("active-leaf-change", podNotesLeaf);
		},
		close(leaf: WorkspaceLeaf) {
			open.splice(open.indexOf(leaf), 1);
			if (workspace.activeEditor === leaf.view) workspace.activeEditor = null;
			trigger("layout-change");
		},
	};
}

const loaded: PodNotes[] = [];

async function loadPlugin(data: Record<string, unknown>) {
	const commands: obsidian.Command[] = [];
	const { vault, read, notes } = fakeVault();
	const workspace = fakeWorkspace();
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin, {
		loadData: vi.fn().mockResolvedValue(data),
		saveData: vi.fn().mockResolvedValue(undefined),
		addCommand: vi.fn((command: obsidian.Command) => commands.push(command)),
		addRibbonIcon: vi.fn(() => document.createElement("div")),
		addSettingTab: vi.fn(),
		registerView: vi.fn(),
		registerObsidianProtocolHandler: vi.fn(),
		registerEvent: vi.fn(),
		registerDomEvent: vi.fn(),
		writeRefusal: null,
		writeInFlight: null,
		storeUnsubscribers: [],
		views: new Set(),
		manifest: { dir: ".obsidian/plugins/podnotes" },
		app: {
			secretStorage: {
				getSecret: vi.fn(() => null),
				setSecret: vi.fn(),
				listSecrets: vi.fn(() => []),
			},
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
			vault: {
				...vault,
				adapter: {
					exists: vi.fn(async () => true),
					read: vi.fn(async () =>
						dataFileText(vi.mocked(plugin.saveData).mock.lastCall?.[0]),
					),
				},
			},
			workspace: workspace.workspace,
		},
	});
	await plugin.onload();
	loaded.push(plugin);

	const run = (id: string) => commands.find((command) => command.id === id)!.callback!();
	return { plugin, commands, run, read, notes, ...workspace };
}

let notice: MockInstance<typeof obsidian.Notice>;

beforeEach(() => {
	// jsdom implements no media loading; unload releases the player's element.
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
	notice = vi.spyOn(obsidian, "Notice");
});

afterEach(() => {
	for (const plugin of loaded.splice(0)) plugin.onunload();
	vi.restoreAllMocks();
});

describe("capture", () => {
	it("lands at the caret of the editor focused before the PodNotes view", async () => {
		const { run, openNote, focusPodNotes, notes } = await loadPlugin(playing);
		const { editor } = openNote("Journal.md", "Listening notes\n\nLater", 16);
		focusPodNotes();

		run("capture-timestamp");

		expect(editor.getValue()).toBe("Listening notes\n- 00:20:34\nLater");
		expect(notes.size).toBe(0);
		expect(notice).not.toHaveBeenCalled();
	});

	it("keeps a table row intact when the caret is in a cell", async () => {
		const { plugin, run, openNote, focusPodNotes } = await loadPlugin(playing);
		plugin.settings.timestamp.template = "{{time}} | seen\n";
		const { editor } = openNote("Table.md", "| Time | Note |\n| --- | --- |\n| ");
		focusPodNotes();

		run("capture-timestamp");

		expect(editor.getValue()).toBe("| Time | Note |\n| --- | --- |\n| 00:20:34 \\| seen ");
	});

	it("goes to the episode note once the last editor's tab is closed", async () => {
		const { run, openNote, focusPodNotes, close, read } = await loadPlugin(playing);
		const { leaf, editor } = openNote("Journal.md", "");
		focusPodNotes();
		close(leaf);

		run("capture-timestamp");

		await vi.waitFor(() => expect(read(NOTE_PATH)).toBe("# Saved Episode\n- 00:20:34\n"));
		expect(editor.getValue()).toBe("");
	});

	it("goes to the episode note when the last note is in Reading view", async () => {
		const { plugin, openNote, focusPodNotes, read } = await loadPlugin(playing);
		const { mode, editor } = openNote("Journal.md", "Notes");
		mode.mockReturnValue("preview");

		expect(await plugin.capture.timestamp()).toMatchObject({ destination: "note" });
		focusPodNotes();
		expect(await plugin.capture.timestamp()).toMatchObject({ destination: "note" });

		expect(read(NOTE_PATH)).toBe("# Saved Episode\n- 00:20:34\n- 00:20:34\n");
		expect(editor.getValue()).toBe("Notes");
	});

	describe("past a note in Reading view", () => {
		async function editorThenReading() {
			const session = await loadPlugin(playing);
			session.plugin.settings.timestamp.template = "- {{time}}\n";
			const editing = session.openNote("Journal.md", "Before\nAfter", 7);
			const reading = session.openInReadingView("Article.md", "Read only");
			return { ...session, editing, reading };
		}

		it("lands at the caret of the editor used before it", async () => {
			const { run, focusPodNotes, editing, reading, notes } = await editorThenReading();
			focusPodNotes();

			run("capture-timestamp");
			run("capture-segment-10s");

			expect(editing.editor.getValue()).toBe(
				"Before\n- 00:20:34\n- 00:20:24-00:20:34\nAfter",
			);
			expect(reading.editor.getValue()).toBe("Read only");
			expect(notes.size).toBe(0);
		});

		it("lands in the editor used before it while the Reading view has focus", async () => {
			const { run, editing, reading, notes } = await editorThenReading();

			run("capture-timestamp");

			expect(editing.editor.getValue()).toBe("Before\n- 00:20:34\nAfter");
			expect(reading.editor.getValue()).toBe("Read only");
			expect(notes.size).toBe(0);
		});

		it("lands in that note once it is switched to editing while it has focus", async () => {
			const { run, focusPodNotes, editing, reading } = await editorThenReading();
			reading.mode.mockReturnValue("source");
			focusPodNotes();

			run("capture-timestamp");

			expect(reading.editor.getValue()).toBe("Read only- 00:20:34\n");
			expect(editing.editor.getValue()).toBe("Before\nAfter");
		});
	});

	it("goes to the episode note once the editor used last is switched to Reading view", async () => {
		const { run, openNote, focusPodNotes, read } = await loadPlugin(playing);
		const { mode, editor } = openNote("Journal.md", "Notes");
		focusPodNotes();
		mode.mockReturnValue("preview");

		run("capture-timestamp");

		await vi.waitFor(() => expect(read(NOTE_PATH)).toBe("# Saved Episode\n- 00:20:34\n"));
		expect(editor.getValue()).toBe("Notes");
	});

	it("creates the episode note from its template, then appends to it", async () => {
		const { plugin, read } = await loadPlugin(playing);

		expect(await plugin.capture.timestamp()).toEqual({
			destination: "note",
			path: NOTE_PATH,
			text: "- 00:20:34\n",
			created: true,
		});
		expect(await plugin.capture.timestamp()).toEqual({
			destination: "note",
			path: NOTE_PATH,
			text: "- 00:20:34\n",
			created: false,
		});
		expect(read(NOTE_PATH)).toBe("# Saved Episode\n- 00:20:34\n- 00:20:34\n");
		expect(notice).not.toHaveBeenCalled();
	});

	it("appends to an episode note the user already has, without a notice", async () => {
		const { plugin, notes, read } = await loadPlugin(playing);
		notes.set(NOTE_PATH, { file: vaultFile(NOTE_PATH), content: "# Mine" });

		expect(await plugin.capture.timestamp()).toMatchObject({
			destination: "note",
			created: false,
		});
		expect(read(NOTE_PATH)).toBe("# Mine\n- 00:20:34\n");
		expect(notice).not.toHaveBeenCalled();
	});

	it("asks for an episode when none is loaded, and writes nothing", async () => {
		const { run, openNote, notes } = await loadPlugin({
			...playing,
			currentEpisode: undefined,
		});
		const { editor } = openNote("Journal.md", "Notes");

		run("capture-timestamp");

		expect(notice).toHaveBeenCalledWith("Play an episode to capture");
		expect(editor.getValue()).toBe("Notes");
		expect(notes.size).toBe(0);
	});

	describe("segments and the headphones' previous-track button", () => {
		const handlers = new Map<string, () => void>();
		const original = Object.getOwnPropertyDescriptor(window.navigator, "mediaSession");

		beforeEach(() => {
			Object.defineProperty(window.navigator, "mediaSession", {
				configurable: true,
				value: {
					setActionHandler: (action: string, handler: (() => void) | null) => {
						if (handler) handlers.set(action, handler);
						else handlers.delete(action);
					},
					setPositionState: () => {},
				},
			});
		});

		afterEach(() => {
			handlers.clear();
			if (original) Object.defineProperty(window.navigator, "mediaSession", original);
			else Reflect.deleteProperty(window.navigator, "mediaSession");
		});

		it("go to the editor focused before the PodNotes view", async () => {
			const { plugin, run, openNote, focusPodNotes, notes } = await loadPlugin(playing);
			plugin.settings.timestamp.template = "- {{time}}\n";
			const { editor } = openNote("Journal.md", "");
			focusPodNotes();

			run("capture-segment-10s");
			run("capture-segment-20s");
			handlers.get("previoustrack")!();

			expect(editor.getValue()).toBe(
				"- 00:20:24-00:20:34\n- 00:20:14-00:20:34\n- 00:20:34\n",
			);
			expect(notes.size).toBe(0);
		});

		it("go to the episode note with no editor open", async () => {
			const { run, read } = await loadPlugin(playing);

			run("capture-segment-10s");
			await vi.waitFor(() => expect(read(NOTE_PATH)).toContain("00:20:34\n"));
			handlers.get("previoustrack")!();

			await vi.waitFor(() =>
				expect(read(NOTE_PATH)).toBe("# Saved Episode\n- 00:20:24-00:20:34\n- 00:20:34\n"),
			);
		});
	});
});

describe("Create episode note", () => {
	const feed = { title: "Pod", url: "https://feeds.test/pod.xml", artworkUrl: "" };
	const withFeed = { schemaVersion: 2, note: playing.note, savedFeeds: { Pod: feed } };
	const rss = (items: string[]) =>
		`<rss><channel><title>Pod</title>${items
			.map(
				(title) =>
					`<item><title>${title}</title><enclosure url="https://media.test/${title}.mp3"/></item>`,
			)
			.join("")}</channel></rss>`;
	const command = (commands: obsidian.Command[]) =>
		commands.find(({ id }) => id === "create-podcast-note")!.checkCallback!;

	/** The pickers opened so far, as the user sees them. */
	function watchPickers() {
		const open = vi.spyOn(PickerModal.prototype, "open");
		const shown = (index: number) => {
			const modal = open.mock.contexts[index] as PickerModal<unknown>;
			const items = modal.getItems();
			const texts = items.map((item) => modal.getItemText(item));
			return {
				placeholder: modal.inputEl.placeholder,
				texts,
				choose: (text: string) => modal.onChooseItem(items[texts.indexOf(text)]),
			};
		};
		return { open, shown };
	}

	it("picks a podcast, then one of its episodes, and creates that episode's note without playing it", async () => {
		vi.mocked(fetchTextWithTimeout).mockResolvedValue(rss(["Two", "One"]));
		const pickers = watchPickers();
		const { plugin, commands, read, opened } = await loadPlugin(withFeed);

		expect(command(commands)(true)).toBe(true);
		command(commands)(false);

		expect(pickers.shown(0)).toMatchObject({ placeholder: "Select a podcast", texts: ["Pod"] });
		pickers.shown(0).choose("Pod");

		await vi.waitFor(() => expect(pickers.open).toHaveBeenCalledTimes(2));
		expect(pickers.shown(1)).toMatchObject({
			placeholder: "Select an episode",
			texts: ["Two", "One"],
		});
		pickers.shown(1).choose("One");

		await vi.waitFor(() => expect(opened).toEqual(["PodNotes/Pod/One.md"]));
		expect(read("PodNotes/Pod/One.md")).toBe("# One");
		expect(plugin.api.podcast).toBeUndefined();
		expect(get(plugin.player.state).status).toBe("empty");
	});

	it.each([
		[
			"cannot be loaded",
			() => vi.mocked(fetchTextWithTimeout).mockRejectedValue(new Error("offline")),
			"Could not load the podcast feed",
		],
		[
			"has no episodes",
			() => vi.mocked(fetchTextWithTimeout).mockResolvedValue(rss([])),
			"No episodes in this podcast",
		],
	])("says so when the podcast %s", async (_, respond, message) => {
		respond();
		const pickers = watchPickers();
		const { commands, notes } = await loadPlugin(withFeed);

		command(commands)(false);
		pickers.shown(0).choose("Pod");

		await vi.waitFor(() => expect(notice).toHaveBeenCalledWith(message));
		expect(pickers.open).toHaveBeenCalledTimes(1);
		expect(notes.size).toBe(0);
	});

	it("loads the podcast saved under another name than its title", async () => {
		vi.mocked(fetchTextWithTimeout).mockResolvedValue(rss(["One"]));
		const pickers = watchPickers();
		const { commands } = await loadPlugin({
			...withFeed,
			savedFeeds: { "Old Name": feed },
		});

		command(commands)(false);
		expect(pickers.shown(0).texts).toEqual(["Pod"]);
		pickers.shown(0).choose("Pod");

		await vi.waitFor(() => expect(pickers.open).toHaveBeenCalledTimes(2));
		expect(pickers.shown(1).texts).toEqual(["One"]);
	});

	it("says a private podcast's address is not on this device", async () => {
		const pickers = watchPickers();
		const { commands, notes } = await loadPlugin({
			...withFeed,
			savedFeeds: {
				Pod: { ...feed, url: privateFeedPlaceholder("Pod"), urlSecretId: "pod-feed-url" },
			},
		});

		command(commands)(false);
		pickers.shown(0).choose("Pod");

		await vi.waitFor(() =>
			expect(notice).toHaveBeenCalledWith(
				'The private feed address for "Pod" is not available on this device.',
			),
		);
		expect(notice).not.toHaveBeenCalledWith("Could not load the podcast feed");
		expect(fetchTextWithTimeout).not.toHaveBeenCalled();
		expect(pickers.open).toHaveBeenCalledTimes(1);
		expect(notes.size).toBe(0);
	});

	it("lists a long podcast's older episodes when a restart left only its newest cached", async () => {
		vi.mocked(fetchTextWithTimeout).mockResolvedValue(rss(["Two", "One"]));
		const pickers = watchPickers();
		const { plugin, commands } = await loadPlugin(withFeed);
		const newest = { title: "Two", streamUrl: "https://media.test/Two.mp3", description: "" };
		vi.mocked(plugin.app.loadLocalStorage).mockReturnValue(
			JSON.stringify({
				[feed.url]: {
					channel: { title: "Pod" },
					items: [{ ...newest, content: "", mediaType: "audio" }],
					complete: false,
					updatedAt: Date.now(),
				},
			}),
		);

		command(commands)(false);
		pickers.shown(0).choose("Pod");

		await vi.waitFor(() => expect(pickers.open).toHaveBeenCalledTimes(2));
		expect(pickers.shown(1).texts).toEqual(["Two", "One"]);
	});

	it("creates the loaded episode's note without a picker", async () => {
		const pickers = watchPickers();
		const { commands, read, opened } = await loadPlugin({
			...playing,
			savedFeeds: { Pod: feed },
		});

		command(commands)(false);

		await vi.waitFor(() => expect(opened).toEqual([NOTE_PATH]));
		expect(read(NOTE_PATH)).toBe("# Saved Episode");
		expect(pickers.open).not.toHaveBeenCalled();
	});

	it("is unavailable with nothing loaded and no saved podcast", async () => {
		const { commands } = await loadPlugin({ schemaVersion: 2, note: playing.note });

		expect(command(commands)(true)).toBe(false);
	});
});

describe("Reorder Queue", () => {
	it("reveals the view, then opens the Queue page, with any queue", async () => {
		const { plugin, commands, run } = await loadPlugin({ schemaVersion: 2 });
		const order: string[] = [];
		vi.spyOn(plugin, "activateView").mockImplementation(async () => {
			order.push(`reveal on ${plugin.navigation.current.page.kind}`);
		});
		plugin.navigation.replace({ kind: "playlists" });

		// A check would hide it from the palette while the queue is short.
		expect(commands.find(({ id }) => id === "reorder-queue")?.checkCallback).toBeUndefined();
		run("reorder-queue");

		await vi.waitFor(() => expect(plugin.navigation.current.page).toEqual({ kind: "queue" }));
		expect(order).toEqual(["reveal on playlists"]);
	});

	it("logs a view that does not open, and stays on the page it was on", async () => {
		const { plugin, run } = await loadPlugin({ schemaVersion: 2 });
		const failure = new Error("no leaf");
		vi.spyOn(plugin, "activateView").mockRejectedValue(failure);
		const logged = vi.spyOn(console, "error").mockImplementation(() => {});
		plugin.navigation.replace({ kind: "playlists" });

		run("reorder-queue");

		await vi.waitFor(() =>
			expect(logged.mock.calls).toEqual([["PodNotes: failed to open the Queue", failure]]),
		);
		expect(plugin.navigation.current.page).toEqual({ kind: "playlists" });
	});
});

describe("Transcribe", () => {
	it.each(["podnotes-transcribe", "podnotes-transcribe-audio"])(
		"%s is available for an audio episode only while online",
		async (id) => {
			const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
			const { commands } = await loadPlugin(playing);
			const available = () =>
				commands.find((command) => command.id === id)!.checkCallback!(true);

			expect(available()).toBe(true);
			online.mockReturnValue(false);
			window.dispatchEvent(new Event("offline"));
			expect(available()).toBe(false);
		},
	);
});
