// @vitest-environment jsdom
import { TFile, type TAbstractFile } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import PodNotes from "./main";
import { selectSource } from "./player/source";
import { downloadedEpisodes, localFiles, queue } from "./store";
import type { LocalEpisode } from "./types/LocalEpisode";
import { dataFileText } from "../tests/mocks/dataFileWriter";

type RenameListener = (file: TAbstractFile, oldPath: string) => void;

/** A vault file at `path`, as Obsidian hands it to listeners. */
function vaultFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		extension: name.split(".").pop() ?? "",
		basename: name.replace(/\.[^.]+$/, ""),
		stat: { ctime: 0, mtime: 0, size: 960_044 },
	});
}

/** A file as "Play with PodNotes" registers it. */
function registered(path: string): LocalEpisode {
	const file = vaultFile(path);
	return {
		title: file.basename,
		description: "",
		content: "",
		podcastName: "local file",
		url: `[[${file.name}]]`,
		streamUrl: `app://resource/${path}`,
		filePath: path,
		mediaType: "audio",
	};
}

const loaded: PodNotes[] = [];
let vaultPaths: string[] = [];
let renameListeners: RenameListener[] = [];

/** Obsidian moving a file: the file is at its new path, then listeners hear of it. */
function move(oldPath: string, newPath: string): void {
	vaultPaths = vaultPaths.map((path) => (path === oldPath ? newPath : path));
	for (const listener of renameListeners) listener(vaultFile(newPath), oldPath);
}

async function loadPlugin(data: Record<string, unknown>): Promise<PodNotes> {
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin, {
		loadData: vi.fn().mockResolvedValue(data),
		saveData: vi.fn().mockResolvedValue(undefined),
		addCommand: vi.fn(),
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
			vault: {
				on: vi.fn((name: string, listener: RenameListener) => {
					if (name === "rename") renameListeners.push(listener);
					return {};
				}),
				getAbstractFileByPath: (path: string) =>
					vaultPaths.includes(path) ? vaultFile(path) : null,
				getResourcePath: (file: TFile) => `app://resource/${file.path}`,
				adapter: {
					exists: vi.fn(async () => true),
					read: vi.fn(async () =>
						dataFileText(vi.mocked(plugin.saveData).mock.lastCall?.[0]),
					),
				},
			},
			fileManager: { generateMarkdownLink: (file: TFile) => `[[${file.name}]]` },
			workspace: {
				onLayoutReady: vi.fn(),
				on: vi.fn(() => ({})),
				getLeavesOfType: vi.fn(() => []),
				getRightLeaf: vi.fn(() => null),
				revealLeaf: vi.fn(),
			},
		},
	});
	await plugin.onload();
	loaded.push(plugin);
	return plugin;
}

beforeEach(() => {
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
	renameListeners = [];
});

afterEach(() => {
	for (const plugin of loaded.splice(0)) plugin.onunload();
	vi.restoreAllMocks();
});

describe("a queued local file whose vault file moves", () => {
	it("plays from where the file is now once the queue reaches it", async () => {
		const clip = registered("Fixtures/Clip One.wav");
		vaultPaths = ["Fixtures/Clip One.wav", "Fixtures/Lead.wav"];
		const plugin = await loadPlugin({
			schemaVersion: 2,
			currentEpisode: registered("Fixtures/Lead.wav"),
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [clip] },
			downloadedEpisodes: {
				"local file": [{ ...clip, size: 960_044 }, registered("Fixtures/Lead.wav")],
			},
		});

		move("Fixtures/Clip One.wav", "Fixtures/A/Clip One.wav");

		const [queued] = get(queue).episodes;
		expect(queued).toMatchObject({
			title: "Clip One",
			filePath: "Fixtures/A/Clip One.wav",
			streamUrl: "app://resource/Fixtures/A/Clip One.wav",
			url: "[[Clip One.wav]]",
		});
		expect(selectSource(queued, get(downloadedEpisodes), plugin.app.vault).src).toBe(
			"app://resource/Fixtures/A/Clip One.wav",
		);
		expect(
			get(localFiles).episodes.map((episode) => (episode as LocalEpisode).filePath),
		).toEqual(["Fixtures/A/Clip One.wav", "Fixtures/Lead.wav"]);
		await plugin.flushSaves();
		const saved = vi.mocked(plugin.saveData).mock.lastCall?.[0] as typeof DEFAULT_SETTINGS;
		expect(saved.queue.episodes.map((episode) => (episode as LocalEpisode).filePath)).toEqual([
			"Fixtures/A/Clip One.wav",
		]);
		expect(saved.downloadedEpisodes["local file"].map((episode) => episode.filePath)).toEqual([
			"Fixtures/A/Clip One.wav",
			"Fixtures/Lead.wav",
		]);
	});
});
