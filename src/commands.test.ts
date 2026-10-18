// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { MarkdownView, TFile, TFolder, type WorkspaceLeaf } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import PodNotes from "./main";
import { QUEUE_SETTINGS, VIEW_TYPE } from "./constants";
import type { Episode } from "./types/Episode";
import { PickerModal } from "./ui/PickerModal";
import { fetchTextWithTimeout } from "./utility/networkRequest";
import { privateFeedPlaceholder } from "./utility/privateFeedUrl";
import { dataFileText } from "../tests/mocks/dataFileWriter";
import { fakeEditor, editInTableCell } from "../tests/mocks/captureEditor";

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
/** Playing an episode its feed can link to, with another episode next in the queue. */
const linkedPlaying = {
	...playing,
	currentEpisode: { ...episode, feedUrl: "https://example.com/feed.xml", guid: "saved-1" },
	queue: {
		...QUEUE_SETTINGS,
		episodes: [{ ...episode, title: "Queued Episode", url: "https://example.com/queued" }],
	},
};
const LINK =
	"obsidian://podnotes?episodeName=Saved%20Episode&url=https%3A%2F%2Fexample.com%2Ffeed.xml&guid=saved-1";

function vaultFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		basename: name.replace(/\.md$/, ""),
		extension: "md",
	});
}

/**
 * `notes` is what is on disk. Like Obsidian's, `cachedRead` answers from a cache that a
 * change on disk outside the vault does not update; `process` reads the disk.
 */
function fakeVault() {
	const notes = new Map<string, { file: TFile; content: string }>();
	const cache = new Map<string, string>();
	const write = (file: TFile, content: string) => {
		notes.get(file.path)!.content = content;
		cache.set(file.path, content);
		return content;
	};
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
			read: async (file: TFile) => notes.get(file.path)!.content,
			cachedRead: async (file: TFile) => {
				if (!cache.has(file.path)) cache.set(file.path, notes.get(file.path)!.content);
				return cache.get(file.path)!;
			},
			modify: async (file: TFile, content: string) => {
				write(file, content);
			},
			process: async (file: TFile, change: (content: string) => string) =>
				write(file, change(notes.get(file.path)!.content)),
		},
	};
}

/** A note opened in a tab is the vault's file, and saving the tab writes its text there. */
function fakeWorkspace(notes: ReturnType<typeof fakeVault>["notes"]) {
	const fileAt = (path: string) => notes.get(path)?.file ?? vaultFile(path);
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
		iterateAllLeaves: vi.fn(),
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
		const view = Object.assign(new MarkdownView(leaf), {
			editor,
			file: fileAt(path),
			save: async () => {
				const note = notes.get(view.file?.path ?? "");
				if (note) note.content = editor.getValue();
			},
		});
		const mode = vi.spyOn(view, "getMode").mockReturnValue(reading ? "preview" : "source");
		leaf.view = view;
		open.push(leaf);
		workspace.activeEditor = view;
		trigger("active-leaf-change", leaf);
		return { leaf, editor, mode };
	};

	const closeUnsaved = (leaf: WorkspaceLeaf) => {
		open.splice(open.indexOf(leaf), 1);
		if (workspace.activeEditor === leaf.view) workspace.activeEditor = null;
		trigger("layout-change");
		return () => (leaf.view as MarkdownView).save();
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
		/** Closes a tab, which saves its note. */
		close(leaf: WorkspaceLeaf) {
			void closeUnsaved(leaf)();
		},
		/** Closes a tab whose save has not landed yet: the returned function lands it. */
		closeUnsaved,
	};
}

const loaded: PodNotes[] = [];

async function loadPlugin(data: Record<string, unknown>) {
	const commands: obsidian.Command[] = [];
	const { vault, read, notes } = fakeVault();
	const workspace = fakeWorkspace(notes);
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
		closing: null,
		writeInFlight: null,
		storeUnsubscribers: [],
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

/** What each Notice said; an Undo notice by its text before the button. */
const said = () =>
	notice.mock.calls.map(([message]) =>
		message instanceof DocumentFragment ? message.firstChild?.textContent : message,
	);

/** Clicks Undo on the latest Undo notice, and waits for what it does. */
async function undo() {
	const undoNotices = notice.mock.calls.flatMap(([message]) =>
		message instanceof DocumentFragment ? [message] : [],
	);
	undoNotices.at(-1)!.querySelector("button")!.click();
	await new Promise((resolve) => setTimeout(resolve));
}

const REFUSED = "The note isn't as the capture left it, so the timestamp stays";

/** QuickAdd as Obsidian holds it while it is enabled, with "Log" set as the QuickAdd choice. */
function withQuickAdd(
	plugin: PodNotes,
	executeChoice = vi.fn(async (_choice: string, _variables: Record<string, string>) => {}),
) {
	Object.assign(plugin.app, { plugins: { plugins: { quickadd: { api: { executeChoice } } } } });
	plugin.settings.timestamp.quickAddChoice = "Log";
	return executeChoice;
}

/** A note's tab, and the changes a user can make to it. */
interface Tab {
	readonly leaf: WorkspaceLeaf;
	readonly mode: MockInstance<() => "source" | "preview">;
	close(): void;
}

describe("capture", () => {
	it("lands at the caret of the editor focused before the PodNotes view", async () => {
		const { run, openNote, focusPodNotes, notes } = await loadPlugin(playing);
		const { editor } = openNote("Journal.md", "Listening notes\n\nLater", 16);
		focusPodNotes();

		run("capture-timestamp");

		expect(editor.getValue()).toBe("Listening notes\n- 00:20:34\nLater");
		expect(notes.size).toBe(0);
		expect(said()).toEqual(["Timestamp added to Journal"]);
	});

	it("keeps a table row intact when the caret is in a cell", async () => {
		const { plugin, run, openNote, focusPodNotes } = await loadPlugin(playing);
		plugin.settings.timestamp.template = "{{time}} | seen\n";
		const { editor } = openNote("Table.md", "| Time | Note |\n| --- | --- |\n| ");
		focusPodNotes();

		run("capture-timestamp");

		expect(editor.getValue()).toBe("| Time | Note |\n| --- | --- |\n| 00:20:34 \\| seen ");
	});

	it("captures before Obsidian delivers the leaf-change event after a player click", async () => {
		const { plugin, openNote, workspace, read } = await loadPlugin(playing);
		const { editor } = openNote("Journal.md", "Notes\n");
		workspace.activeEditor = null;

		expect(await plugin.capture.timestamp()).toMatchObject({
			destination: "editor",
			path: "Journal.md",
		});
		expect(editor.getValue()).toBe("Notes\n- 00:20:34");
		expect(read(NOTE_PATH)).toBeUndefined();
	});

	describe("in Live Preview", () => {
		const TABLE = "| Time | Note |\n| --- | --- |\n| Start | anchor |\nAfter";

		async function inCell() {
			const session = await loadPlugin(playing);
			const tab = session.openNote("Table.md", TABLE);
			const cell = editInTableCell(tab.editor, "anchor");
			session.focusPodNotes();
			return { ...session, ...tab, cell };
		}

		it("lands in a table cell's editor, which shows the pipes the note escapes", async () => {
			const { plugin, editor, cell } = await inCell();
			plugin.settings.timestamp.template = "{{time}} | a \\| b \\\\| c\n";

			expect(await plugin.capture.timestamp()).toEqual({
				destination: "editor",
				path: "Table.md",
				text: "00:20:34 \\| a \\| b \\\\\\| c ",
				created: false,
			});
			expect(cell.editor.getValue()).toBe("anchor00:20:34 | a | b \\\\| c ");
			expect(editor.getValue()).toBe(
				"| Time | Note |\n| --- | --- |\n| Start | anchor00:20:34 \\| a \\| b \\\\\\| c  |\nAfter",
			);
		});

		it("keeps each capture in a table cell, and Undo takes out only the last", async () => {
			const { run, editor, cell } = await inCell();
			run("capture-timestamp");
			const first = editor.getValue();
			run("capture-segment-10s");
			expect(cell.editor.getValue()).toBe("anchor- 00:20:34- 00:20:24-00:20:34");

			await undo();

			expect(first).toBe(
				"| Time | Note |\n| --- | --- |\n| Start | anchor- 00:20:34 |\nAfter",
			);
			expect(editor.getValue()).toBe(first);
			expect(said()).toEqual(["Timestamp added to Table", "Timestamp added to Table"]);
		});

		it("writes outside a table through the note's editor", async () => {
			const { run, openNote, focusPodNotes } = await loadPlugin(playing);
			const { editor } = openNote("Journal.md", "Notes\n");
			Object.assign(editor, { editorComponent: { tableCell: null } });
			focusPodNotes();
			run("capture-timestamp");
			expect(editor.getValue()).toBe("Notes\n- 00:20:34");

			await undo();

			expect(editor.getValue()).toBe("Notes\n");
		});

		it("ends a cell no longer in the document, and writes at the note's caret with an exact Undo", async () => {
			const { plugin, editor, cell } = await inCell();
			plugin.settings.timestamp.template = "{{time}} | cut\n";
			cell.containerEl.isConnected = false;
			editor.replaceRange("Synced\n", editor.offsetToPos(0));
			editor.setSelection(editor.offsetToPos(editor.getValue().indexOf("anchor") + 6));
			const before = editor.getValue();

			expect(await plugin.capture.timestamp()).toMatchObject({ text: "00:20:34 \\| cut " });

			expect(editor.getValue()).toBe(
				"Synced\n| Time | Note |\n| --- | --- |\n| Start | anchor00:20:34 \\| cut  |\nAfter",
			);
			expect(cell.editor.getValue()).toBe("anchor");
			await undo();
			expect(editor.getValue()).toBe(before);
		});

		it("ends a detached cell whose old range covers the capture before Undo puts the note back", async () => {
			const { run, openNote, focusPodNotes } = await loadPlugin(playing);
			const { editor } = openNote("Journal.md", "Notes\n");
			focusPodNotes();
			run("capture-timestamp");
			editInTableCell(editor, "Notes\n- 00:20:34").containerEl.isConnected = false;

			await undo();

			expect(editor.getValue()).toBe("Notes\n");
		});

		it("falls back to the note editor when the cell's replaceSelection is not a function", async () => {
			const { plugin, openNote, focusPodNotes } = await loadPlugin(playing);
			const { editor } = openNote("Table.md", TABLE, TABLE.indexOf("anchor") + 6);
			Object.assign(editor, {
				editorComponent: { tableCell: { editor: { replaceSelection: "unavailable" } } },
			});
			focusPodNotes();

			expect(await plugin.capture.timestamp()).toEqual({
				destination: "editor",
				path: "Table.md",
				text: "- 00:20:34",
				created: false,
			});
			expect(editor.getValue()).toBe(
				"| Time | Note |\n| --- | --- |\n| Start | anchor- 00:20:34 |\nAfter",
			);
		});

		it("still writes through a cell no longer in the document when Obsidian has no destroyTableCell", async () => {
			const { run, editor, cell } = await inCell();
			cell.containerEl.isConnected = false;
			Reflect.deleteProperty(Reflect.get(editor, "editorComponent"), "destroyTableCell");

			run("capture-timestamp");

			expect(cell.editor.getValue()).toBe("anchor- 00:20:34");
		});
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
		expect(said()).toEqual(["Created Saved Episode", "Timestamp added to Saved Episode"]);
	});

	it("appends to an episode note the user already has", async () => {
		const { plugin, notes, read } = await loadPlugin(playing);
		notes.set(NOTE_PATH, { file: vaultFile(NOTE_PATH), content: "# Mine" });

		expect(await plugin.capture.timestamp()).toMatchObject({
			destination: "note",
			created: false,
		});
		expect(read(NOTE_PATH)).toBe("# Mine\n- 00:20:34\n");
		expect(said()).toEqual(["Timestamp added to Saved Episode"]);
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

	describe("Undo", () => {
		async function intoEditor(text: string, caret?: number) {
			const session = await loadPlugin(playing);
			session.notes.set("Journal.md", { file: vaultFile("Journal.md"), content: text });
			const tab = session.openNote("Journal.md", text, caret);
			session.focusPodNotes();
			session.run("capture-timestamp");
			return { ...session, ...tab };
		}

		it("takes the timestamp out of the editor, leaving the note as it was", async () => {
			const { editor } = await intoEditor("Listening notes\n\nLater", 16);

			await undo();

			expect(editor.getValue()).toBe("Listening notes\n\nLater");
			expect(said()).toEqual(["Timestamp added to Journal"]);
		});

		it.each([
			["before it", 0, "Re: Notes\n- 00:20:34"],
			["inside it", 8, "Notes\n- 01:00:20:34"],
			["after it", 16, "Notes\n- 00:20:34 a great point"],
		])(
			"leaves the timestamp once the user typed %s, and says so",
			async (_where, at, edited) => {
				const { editor } = await intoEditor("Notes\n");
				editor.replaceRange(
					{ 0: "Re: ", 8: "01:", 16: " a great point" }[at]!,
					editor.offsetToPos(at),
				);

				await undo();

				expect(editor.getValue()).toBe(edited);
				expect(said()).toEqual(["Timestamp added to Journal", REFUSED]);
			},
		);

		it("leaves the timestamp once a copy of it was pasted before it, and says so", async () => {
			const { editor } = await intoEditor("Notes\n");
			editor.replaceRange("- 00:20:34\nA thought\n", editor.offsetToPos(6));

			await undo();

			expect(editor.getValue()).toBe("Notes\n- 00:20:34\nA thought\n- 00:20:34");
			expect(said()).toEqual(["Timestamp added to Journal", REFUSED]);
		});

		it("leaves the timestamp while the closed tab's save is pending, and the save keeps it", async () => {
			const { leaf, closeUnsaved, read } = await intoEditor("Notes\n");
			const land = closeUnsaved(leaf);

			await undo();
			expect(read("Journal.md")).toBe("Notes\n");
			await land();

			expect(read("Journal.md")).toBe("Notes\n- 00:20:34");
			expect(said()).toEqual(["Timestamp added to Journal", REFUSED]);
		});

		it("puts back the selection the timestamp replaced", async () => {
			const session = await loadPlugin(playing);
			const { editor } = session.openNote("Journal.md", "Heard: draft line");
			editor.setSelection(editor.offsetToPos(7), editor.offsetToPos(17));
			session.focusPodNotes();
			session.run("capture-timestamp");
			expect(editor.getValue()).toBe("Heard: - 00:20:34");

			await undo();

			expect(editor.getValue()).toBe("Heard: draft line");
			expect(editor.getSelection()).toBe("draft line");
		});

		it("takes the timestamp out of the note's other tab once the tab it went into closed, leaving that tab's caret", async () => {
			const { leaf, editor, close, openNote } = await intoEditor("Notes\nLater", 5);
			const other = openNote("Journal.md", editor.getValue(), 0);
			close(leaf);

			await undo();

			expect(other.editor.getValue()).toBe("Notes\nLater");
			expect(other.editor.getCursor()).toEqual({ line: 0, ch: 0 });
			expect(said()).toEqual(["Timestamp added to Journal"]);
		});

		it.each([
			["its tab was closed", (tab: Tab) => tab.close()],
			[
				"its tab shows another note",
				async (tab: Tab) => {
					const view = tab.leaf.view as MarkdownView;
					await view.save();
					view.file = vaultFile("Other.md");
				},
			],
			[
				"it was switched to Reading view",
				// Obsidian saves a note as it leaves editing.
				async (tab: Tab) => {
					await (tab.leaf.view as MarkdownView).save();
					tab.mode.mockReturnValue("preview");
				},
			],
		])("takes an editor's timestamp out of the saved note once %s", async (_change, change) => {
			const { leaf, mode, close, read } = await intoEditor("Notes\n");
			await change({ leaf, mode, close: () => close(leaf) });

			await undo();

			expect(read("Journal.md")).toBe("Notes\n");
			expect(said()).toEqual(["Timestamp added to Journal"]);
		});

		it("leaves the saved note's timestamp once the note changed there, and says so", async () => {
			const { leaf, close, notes, read } = await intoEditor("Notes\n");
			close(leaf);
			notes.get("Journal.md")!.content = `Re: ${read("Journal.md")}`;

			await undo();

			expect(read("Journal.md")).toBe("Re: Notes\n- 00:20:34");
			expect(said()).toEqual(["Timestamp added to Journal", REFUSED]);
		});

		it("takes the timestamp off the end of the episode note, with the newline it added", async () => {
			const { plugin, notes, read } = await loadPlugin(playing);
			notes.set(NOTE_PATH, { file: vaultFile(NOTE_PATH), content: "# Mine" });
			await plugin.capture.timestamp();

			await undo();

			expect(read(NOTE_PATH)).toBe("# Mine");
			expect(said()).toEqual(["Timestamp added to Saved Episode"]);
		});

		it("keeps a note it created, taking out only the timestamp", async () => {
			const { plugin, notes, read } = await loadPlugin(playing);
			await plugin.capture.timestamp();

			await undo();

			expect([...notes.keys()]).toEqual([NOTE_PATH]);
			expect(read(NOTE_PATH)).toBe("# Saved Episode");
			expect(said()).toEqual(["Created Saved Episode"]);
		});

		it.each([
			["the user wrote after it", (text: string) => `${text}My thought\n`],
			[
				"a copy of it was pasted before it",
				(text: string) =>
					text.replace("- 00:20:34\n", "- 00:20:34\nA thought\n- 00:20:34\n"),
			],
		])("leaves the episode note's timestamp once %s, and says so", async (_change, change) => {
			const { plugin, notes, read } = await loadPlugin(playing);
			notes.set(NOTE_PATH, { file: vaultFile(NOTE_PATH), content: "# Mine\n" });
			await plugin.capture.timestamp();
			const note = notes.get(NOTE_PATH)!;
			note.content = change(note.content);
			const changed = note.content;

			await undo();

			expect(read(NOTE_PATH)).toBe(changed);
			expect(said()).toEqual(["Timestamp added to Saved Episode", REFUSED]);
		});

		it("leaves the episode note's timestamp once the note's open editor holds more, and says so", async () => {
			const { plugin, notes, openNote, read } = await loadPlugin(playing);
			notes.set(NOTE_PATH, { file: vaultFile(NOTE_PATH), content: "# Mine\n" });
			await plugin.capture.timestamp();
			const { editor } = openNote(NOTE_PATH, `${read(NOTE_PATH)}Unsaved line\n`);

			await undo();

			expect(editor.getValue()).toBe("# Mine\n- 00:20:34\nUnsaved line\n");
			expect(read(NOTE_PATH)).toBe("# Mine\n- 00:20:34\n");
			expect(said()).toEqual(["Timestamp added to Saved Episode", REFUSED]);
		});

		it("leaves the timestamp once another open editor of the note holds other text, and says so", async () => {
			const { editor, openNote, read } = await intoEditor("Notes\n");
			const other = openNote("Journal.md", "Notes\nUnsaved in the other pane");

			await undo();

			expect(editor.getValue()).toBe("Notes\n- 00:20:34");
			expect(other.editor.getValue()).toBe("Notes\nUnsaved in the other pane");
			expect(read("Journal.md")).toBe("Notes\n");
			expect(said()).toEqual(["Timestamp added to Journal", REFUSED]);
		});

		it("takes the timestamp out when every open editor of the note holds it as captured", async () => {
			const { editor, openNote } = await intoEditor("Notes\n");
			const other = openNote("Journal.md", editor.getValue());

			await undo();

			expect([editor.getValue(), other.editor.getValue()]).toEqual([
				"Notes\n",
				"Notes\n- 00:20:34",
			]);
			expect(said()).toEqual(["Timestamp added to Journal"]);
		});

		it("takes the timestamp out through the episode note's open editor", async () => {
			const { plugin, notes, openNote, read } = await loadPlugin(playing);
			notes.set(NOTE_PATH, { file: vaultFile(NOTE_PATH), content: "# Mine\n" });
			await plugin.capture.timestamp();
			const { editor } = openNote(NOTE_PATH, read(NOTE_PATH)!);
			notes.get(NOTE_PATH)!.content = "on disk only";

			await undo();

			expect(editor.getValue()).toBe("# Mine\n");
			expect(read(NOTE_PATH)).toBe("on disk only");
		});

		it("leaves the episode note's timestamp once a change on disk is newer than Obsidian's cache, and says so", async () => {
			const { plugin, notes, read } = await loadPlugin(playing);
			await plugin.capture.timestamp();
			const note = notes.get(NOTE_PATH)!;
			await plugin.app.vault.cachedRead(note.file);
			note.content = `External user edit\n${note.content}`;
			const newer = note.content;

			await undo();

			expect(read(NOTE_PATH)).toBe(newer);
			expect(said()).toEqual(["Created Saved Episode", REFUSED]);
		});

		it("leaves an episode note timestamp the user edited, and says so", async () => {
			const { plugin, notes, read } = await loadPlugin(playing);
			await plugin.capture.timestamp();
			const note = notes.get(NOTE_PATH)!;
			note.content = note.content.replace("00:20:34", "00:20:34 key point");

			await undo();

			expect(read(NOTE_PATH)).toBe("# Saved Episode\n- 00:20:34 key point\n");
			expect(said()).toEqual(["Created Saved Episode", REFUSED]);
		});

		it("offers no Undo for a capture that ends after the plugin unloaded", async () => {
			const { plugin, read } = await loadPlugin(playing);
			const capturing = plugin.capture.timestamp();
			loaded.splice(loaded.indexOf(plugin), 1);
			plugin.onunload();

			expect(await capturing).toMatchObject({ destination: "note", created: true });
			expect(read(NOTE_PATH)).toBe("# Saved Episode\n- 00:20:34\n");
			expect(said()).toEqual([]);
		});

		it("does nothing once the plugin unloaded", async () => {
			const { plugin, editor } = await intoEditor("Notes");
			loaded.splice(loaded.indexOf(plugin), 1);
			plugin.onunload();

			await undo();

			expect(editor.getValue()).toBe("Notes- 00:20:34");
			expect(said()).toEqual(["Timestamp added to Journal"]);
		});
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

		it("go to the QuickAdd choice when one is set", async () => {
			const { plugin, run, notes } = await loadPlugin(linkedPlaying);
			const executeChoice = withQuickAdd(plugin);

			run("capture-segment-10s");
			handlers.get("previoustrack")!();

			await vi.waitFor(() => expect(executeChoice).toHaveBeenCalledTimes(2));
			expect(executeChoice.mock.calls.map(([choice, { time }]) => [choice, time])).toEqual([
				["Log", "20:24-20:34"],
				["Log", "20:34"],
			]);
			expect(notes.size).toBe(0);
		});
	});

	describe("with a QuickAdd choice", () => {
		const moment = {
			timestamp: "- 00:20:34",
			time: "20:34",
			seconds: "1234",
			link: `${LINK}&time=1234`,
			episode: "Saved Episode",
			podcast: "Pod",
			url: "https://example.com/saved",
			episodeNote: NOTE_PATH,
		};

		it("runs it once with the capture, and writes nothing itself", async () => {
			const { plugin, run, notes } = await loadPlugin(linkedPlaying);
			const executeChoice = withQuickAdd(plugin);

			run("capture-timestamp");

			await vi.waitFor(() => expect(executeChoice.mock.calls).toEqual([["Log", moment]]));
			expect(notes.size).toBe(0);
			expect(said()).toEqual([]);
		});

		it("runs it with a segment's range, and leaves the editor as it is", async () => {
			const { plugin, run, openNote, focusPodNotes } = await loadPlugin(linkedPlaying);
			const executeChoice = withQuickAdd(plugin);
			const { editor } = openNote("Journal.md", "Notes\n");
			focusPodNotes();

			run("capture-segment-10s");

			await vi.waitFor(() =>
				expect(executeChoice.mock.calls).toEqual([
					[
						"Log",
						{
							...moment,
							timestamp: "- 00:20:24-00:20:34",
							time: "20:24-20:34",
							seconds: "1224",
							link: `${LINK}&time=1224&endTime=1234`,
						},
					],
				]),
			);
			expect(editor.getValue()).toBe("Notes\n");
			expect(said()).toEqual([]);
		});

		it("captures as before when the choice is blank", async () => {
			const { plugin, run, openNote, focusPodNotes } = await loadPlugin(linkedPlaying);
			const executeChoice = withQuickAdd(plugin);
			plugin.settings.timestamp.quickAddChoice = " ";
			const { editor } = openNote("Journal.md", "Notes\n");
			focusPodNotes();

			run("capture-timestamp");

			expect(editor.getValue()).toBe("Notes\n- 00:20:34");
			expect(said()).toEqual(["Timestamp added to Journal"]);
			expect(executeChoice.mock.calls).toEqual([]);
		});

		it("says QuickAdd is needed, and writes nothing, while QuickAdd is not enabled", async () => {
			const { plugin, run, openNote, focusPodNotes, notes } = await loadPlugin(linkedPlaying);
			withQuickAdd(plugin);
			Object.assign(plugin.app, { plugins: { plugins: {} } });
			const { editor } = openNote("Journal.md", "Notes\n");
			focusPodNotes();

			run("capture-timestamp");

			await vi.waitFor(() =>
				expect(said()).toEqual([
					"Install and enable QuickAdd to capture with a QuickAdd choice",
				]),
			);
			expect(editor.getValue()).toBe("Notes\n");
			expect(notes.size).toBe(0);
		});

		it("logs a choice that fails or is cancelled, and leaves no unhandled rejection", async () => {
			const { plugin, run } = await loadPlugin(linkedPlaying);
			const failure = new Error("Input cancelled by user");
			withQuickAdd(plugin, vi.fn().mockRejectedValue(failure));
			const logged = vi.spyOn(console, "error").mockImplementation(() => {});
			const unhandled: unknown[] = [];
			const listen = (reason: unknown) => unhandled.push(reason);
			process.on("unhandledRejection", listen);
			try {
				run("capture-timestamp");
				await new Promise((resolve) => setTimeout(resolve, 20));
			} finally {
				process.off("unhandledRejection", listen);
			}

			expect(unhandled).toEqual([]);
			expect(logged.mock.calls).toEqual([["PodNotes: the QuickAdd choice failed", failure]]);
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
