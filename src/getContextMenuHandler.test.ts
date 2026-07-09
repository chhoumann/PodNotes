import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TFile } from "obsidian";
import { get } from "svelte/store";
import getContextMenuHandler from "./getContextMenuHandler";
import { VIEW_TYPE } from "./constants";
import { currentEpisode, downloadedEpisodes, viewState } from "./store";
import { ViewState } from "./types/ViewState";

// `tsc` resolves `obsidian` to the real typings while Vitest aliases it to
// tests/mocks/obsidian.ts. Build a TFile (so `file instanceof TFile` holds in
// the handler) carrying the fields the handler reads off an audio file.
function audioFile(path: string): TFile {
	const file = new TFile();
	Object.assign(file as unknown as Record<string, unknown>, {
		path,
		extension: path.split(".").pop(),
		basename: path
			.split("/")
			.pop()
			?.replace(/\.[^.]+$/, ""),
		stat: { ctime: 0, mtime: 0, size: 1024 },
	});
	return file;
}

type CapturedItem = {
	title: string;
	icon: string;
	onClick: (() => Promise<void> | void) | null;
};

// Minimal Menu stand-in: records the item the handler adds and exposes its
// click callback so the test can invoke "Play with PodNotes".
function fakeMenu() {
	const items: CapturedItem[] = [];
	const menu = {
		items,
		addItem(cb: (item: unknown) => void) {
			const captured: CapturedItem = { title: "", icon: "", onClick: null };
			const item = {
				setIcon(icon: string) {
					captured.icon = icon;
					return item;
				},
				setTitle(title: string) {
					captured.title = title;
					return item;
				},
				setSection() {
					return item;
				},
				onClick(fn: () => Promise<void> | void) {
					captured.onClick = fn;
					return item;
				},
			};
			cb(item);
			items.push(captured);
			return menu;
		},
	};
	return menu;
}

function setupWorkspace(openLeaves: unknown[]) {
	const newLeaf = { setViewState: vi.fn().mockResolvedValue(undefined) };
	const workspace = {
		_fileMenuHandler: null as ((menu: unknown, file: unknown, source: string) => void) | null,
		on(event: string, cb: (menu: unknown, file: unknown, source: string) => void) {
			if (event === "file-menu") workspace._fileMenuHandler = cb;
			return { event } as unknown;
		},
		getLeavesOfType: vi.fn(() => openLeaves),
		getRightLeaf: vi.fn(() => newLeaf),
		revealLeaf: vi.fn(),
	};
	return { workspace, newLeaf };
}

function makeApp(workspace: unknown, file: TFile) {
	const vault = {
		getAbstractFileByPath: vi.fn((path: string) => (path ? audioFile(path) : file)),
		getResourcePath: vi.fn((f: TFile) => `app://resource/${f.path}?1`),
	};
	// createMediaUrlObjectFromFilePath reads the global `app`.
	(globalThis as { app?: unknown }).app = { vault };
	return {
		workspace,
		vault,
		fileManager: {
			generateMarkdownLink: vi.fn((target: TFile) => `[[${target.path}]]`),
		},
	};
}

async function playFile(
	app: unknown,
	workspace: { _fileMenuHandler: unknown },
	file: TFile,
	title = "Play with PodNotes",
) {
	getContextMenuHandler(app as never);
	const menu = fakeMenu();
	(workspace._fileMenuHandler as (menu: unknown, file: unknown, source: string) => void)(
		menu,
		file,
		"file-explorer-context-menu",
	);
	const play = menu.items.find((i) => i.title === title);
	expect(play).toBeTruthy();
	await play?.onClick?.();
	return menu;
}

afterEach(() => {
	(globalThis as { app?: unknown }).app = undefined;
	vi.restoreAllMocks();
});

beforeEach(() => {
	currentEpisode.set(undefined as never);
	downloadedEpisodes.set({});
	viewState.set(ViewState.PodcastGrid);
});

describe("getContextMenuHandler — Play with PodNotes", () => {
	it("offers the item for audio files and sets it as the current episode", async () => {
		const file = audioFile("Audio/tone.mp3");
		const { workspace } = setupWorkspace([{}]);
		const app = makeApp(workspace, file);

		const menu = await playFile(app, workspace, file);

		const play = menu.items.find((i) => i.title === "Play with PodNotes");
		expect(play?.icon).toBe("play");
		expect(get(currentEpisode)).toMatchObject({
			title: "tone",
			podcastName: "local file",
			filePath: "Audio/tone.mp3",
			streamUrl: "app://resource/Audio/tone.mp3?1",
		});
		expect(get(viewState)).toBe(ViewState.Player);
	});

	it("offers the item for local video files and preserves their media type", async () => {
		const file = audioFile("Videos/lecture.mp4");
		const { workspace } = setupWorkspace([{}]);
		const app = makeApp(workspace, file);

		const menu = await playFile(app, workspace, file, "Play as video with PodNotes");

		expect(menu.items.map((item) => item.title)).toEqual([
			"Play as audio with PodNotes",
			"Play as video with PodNotes",
		]);
		expect(get(currentEpisode)).toMatchObject({
			title: "lecture",
			podcastName: "local file",
			filePath: "Videos/lecture.mp4",
			mediaType: "video",
			streamUrl: "app://resource/Videos/lecture.mp4?1",
		});
		expect(get(viewState)).toBe(ViewState.Player);
	});

	it("can preserve local audio-only ambiguous container files as audio", async () => {
		const file = audioFile("Audio/lecture.mp4");
		const { workspace } = setupWorkspace([{}]);
		const app = makeApp(workspace, file);

		await playFile(app, workspace, file, "Play as audio with PodNotes");

		const stored = get(downloadedEpisodes)["local file"]?.[0];
		expect(stored).toMatchObject({
			title: "lecture",
			filePath: "Audio/lecture.mp4",
			mediaType: "audio",
			streamUrl: "app://resource/Audio/lecture.mp4?1",
		});
		expect(get(currentEpisode)).toMatchObject({
			title: "lecture",
			filePath: "Audio/lecture.mp4",
			mediaType: "audio",
		});
		expect(get(viewState)).toBe(ViewState.Player);
	});

	it("refreshes the stored local file when a same-basename video replaces audio", async () => {
		const audio = audioFile("Audio/lecture.mp3");
		const video = audioFile("Videos/lecture.mp4");
		const { workspace } = setupWorkspace([{}]);
		const app = makeApp(workspace, audio);

		await playFile(app, workspace, audio);
		await playFile(app, workspace, video, "Play as video with PodNotes");

		const stored = get(downloadedEpisodes)["local file"]?.[0];
		expect(stored).toMatchObject({
			title: "lecture",
			filePath: "Videos/lecture.mp4",
			mediaType: "video",
			streamUrl: "app://resource/Videos/lecture.mp4?1",
		});
		expect(get(currentEpisode)).toMatchObject({
			title: "lecture",
			filePath: "Videos/lecture.mp4",
			mediaType: "video",
		});
	});

	it("does not offer the item for non-media files", () => {
		const { workspace } = setupWorkspace([{}]);
		const file = audioFile("Notes/page.md");
		const app = makeApp(workspace, file);

		getContextMenuHandler(app as never);
		const menu = fakeMenu();
		workspace._fileMenuHandler?.(menu, file, "file-explorer-context-menu");

		expect(menu.items.find((i) => i.title === "Play with PodNotes")).toBeUndefined();
	});

	it("reveals the existing player leaf instead of opening a new one (issue #84)", async () => {
		const existingLeaf = { id: "existing" };
		const { workspace, newLeaf } = setupWorkspace([existingLeaf]);
		const file = audioFile("Audio/already-open.mp3");
		const app = makeApp(workspace, file);

		await playFile(app, workspace, file);

		expect(workspace.getRightLeaf).not.toHaveBeenCalled();
		expect(newLeaf.setViewState).not.toHaveBeenCalled();
		expect(workspace.revealLeaf).toHaveBeenCalledWith(existingLeaf);
	});

	it("opens and reveals the player when no leaf is present (issue #84)", async () => {
		const { workspace, newLeaf } = setupWorkspace([]);
		const file = audioFile("Audio/closed-pane.mp3");
		const app = makeApp(workspace, file);

		await playFile(app, workspace, file);

		expect(workspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(newLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE,
			active: true,
		});
		expect(workspace.revealLeaf).toHaveBeenCalledWith(newLeaf);
	});
});
