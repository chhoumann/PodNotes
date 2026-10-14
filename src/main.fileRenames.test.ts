// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { TFile, TFolder, type TAbstractFile } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import PodNotes from "./main";
import { selectSource } from "./player/source";
import {
	downloadedEpisodes,
	favorites,
	localFiles,
	playedEpisodes,
	playlists,
	queue,
} from "./store";
import type DownloadedEpisode from "./types/DownloadedEpisode";
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
async function move(oldPath: string, newPath: string): Promise<void> {
	vaultPaths = vaultPaths.map((path) => (path === oldPath ? newPath : path));
	for (const listener of renameListeners) listener(vaultFile(newPath), oldPath);
	await Promise.resolve();
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
		closing: null,
		writeInFlight: null,
		storeUnsubscribers: [],
		views: new Set(),
		manifest: { dir: ".obsidian/plugins/podnotes" },
		app: {
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
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
				getActiveViewOfType: vi.fn(() => null),
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
		const warn = vi.spyOn(console, "warn");
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
		expect(warn).not.toHaveBeenCalledWith(
			"PodNotes: could not remove old feed caches",
			expect.anything(),
		);

		await move("Fixtures/Clip One.wav", "Fixtures/A/Clip One.wav");

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

describe("a vault file PodNotes tracks that is renamed or moved", () => {
	const progress = () => ({
		"local file::Clip One": {
			title: "Clip One",
			podcastName: "local file",
			time: 42,
			duration: 600,
			finished: false,
		},
	});

	it("keeps a renamed local file's title and progress", async () => {
		const clip = registered("Fixtures/Clip One.wav");
		vaultPaths = ["Fixtures/Clip One.wav"];
		await loadPlugin({
			schemaVersion: 2,
			downloadedEpisodes: { "local file": [{ ...clip, size: 960_044 }] },
			playedEpisodes: progress(),
		});

		await move("Fixtures/Clip One.wav", "Fixtures/Intro.wav");

		expect(get(downloadedEpisodes)["local file"]).toEqual([
			{
				...clip,
				filePath: "Fixtures/Intro.wav",
				url: "[[Intro.wav]]",
				streamUrl: "app://resource/Fixtures/Intro.wav",
				size: 960_044,
			},
		]);
		expect(get(localFiles).episodes).toMatchObject([
			{ title: "Clip One", filePath: "Fixtures/Intro.wav" },
		]);
		expect(get(playedEpisodes)).toEqual(progress());
	});

	it("moves the snapshots that play a local file through its registration", async () => {
		const clip = registered("Fixtures/Clip One.wav");
		const pathless: LocalEpisode = { ...clip };
		delete pathless.filePath;
		vaultPaths = ["Fixtures/Clip One.wav"];
		const plugin = await loadPlugin({
			schemaVersion: 2,
			currentEpisode: pathless,
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [pathless] },
			favorites: { ...DEFAULT_SETTINGS.favorites, episodes: [pathless] },
			playlists: {
				Mix: { ...DEFAULT_SETTINGS.favorites, name: "Mix", episodes: [pathless] },
			},
			downloadedEpisodes: { "local file": [{ ...clip, size: 960_044 }] },
			playedEpisodes: progress(),
		});

		await move("Fixtures/Clip One.wav", "Fixtures/A/Intro.wav");

		const atNewPath = {
			...pathless,
			filePath: "Fixtures/A/Intro.wav",
			url: "[[Intro.wav]]",
			streamUrl: "app://resource/Fixtures/A/Intro.wav",
		};
		expect(get(queue).episodes).toEqual([atNewPath]);
		expect(get(favorites).episodes).toEqual([atNewPath]);
		expect(get(playlists).Mix.episodes).toEqual([atNewPath]);
		expect(plugin.settings.currentEpisode).toEqual(atNewPath);
		expect(get(plugin.player.state).episode).toEqual(atNewPath);
		expect(plugin.api.getPodcastTimeFormatted("HH:mm:ss", true)).toBe(
			"[00:00:42](obsidian://podnotes?episodeName=Clip%20One&url=Fixtures%2FA%2FIntro.wav&time=42)",
		);
	});

	it("keeps a download's episode and takes its new path", async () => {
		const download: DownloadedEpisode = {
			title: "Ep 1",
			description: "",
			content: "",
			podcastName: "Show",
			url: "https://show.example.com/ep-1",
			streamUrl: "https://cdn.example.com/ep-1.mp3",
			filePath: "PodNotes/Show/Ep 1.mp3",
			size: 1,
			downloadedByPodNotes: true,
		};
		vaultPaths = ["PodNotes/Show/Ep 1.mp3"];
		await loadPlugin({ schemaVersion: 2, downloadedEpisodes: { Show: [download] } });

		await move("PodNotes/Show/Ep 1.mp3", "Archive/Ep 1.mp3");

		expect(get(downloadedEpisodes).Show).toEqual([
			{ ...download, filePath: "Archive/Ep 1.mp3" },
		]);
	});

	it("moves the current episode with its file", async () => {
		const clip = registered("Fixtures/Clip One.wav");
		vaultPaths = ["Fixtures/Clip One.wav"];
		const plugin = await loadPlugin({
			schemaVersion: 2,
			currentEpisode: clip,
			downloadedEpisodes: { "local file": [{ ...clip, size: 960_044 }] },
		});

		await move("Fixtures/Clip One.wav", "Fixtures/A/Clip One.wav");

		const atNewPath = { title: "Clip One", filePath: "Fixtures/A/Clip One.wav" };
		expect(plugin.settings.currentEpisode).toMatchObject(atNewPath);
		expect(get(plugin.player.state)).toMatchObject({
			status: "restored",
			episode: atNewPath,
		});
		await plugin.flushSaves();
		const saved = vi.mocked(plugin.saveData).mock.lastCall?.[0] as typeof DEFAULT_SETTINGS;
		expect(saved.currentEpisode).toMatchObject(atNewPath);
	});

	it("keeps two tracked local files apart when one is renamed to the other's name", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const listed = [registered("Fixtures/Clip One.wav"), registered("Fixtures/Lead.wav")];
		vaultPaths = ["Fixtures/Clip One.wav", "Fixtures/Lead.wav"];
		await loadPlugin({
			schemaVersion: 2,
			queue: { ...DEFAULT_SETTINGS.queue, episodes: listed },
			favorites: { ...DEFAULT_SETTINGS.favorites, episodes: listed },
			downloadedEpisodes: { "local file": listed.map((e) => ({ ...e, size: 1 })) },
		});

		await move("Fixtures/Lead.wav", "Archive/Clip One.wav");

		const entries = [
			{ title: "Clip One", filePath: "Fixtures/Clip One.wav" },
			{ title: "Lead", filePath: "Archive/Clip One.wav" },
		];
		expect(get(downloadedEpisodes)["local file"]).toMatchObject(entries);
		expect(get(localFiles).episodes).toMatchObject(entries);
		expect(get(queue).episodes).toMatchObject(entries);
		expect(get(favorites).episodes).toMatchObject(entries);
		expect(notice).not.toHaveBeenCalled();
	});

	it("follows a second rename made in a later task", async () => {
		const clip = registered("Fixtures/A.wav");
		vaultPaths = ["Fixtures/A.wav"];
		const plugin = await loadPlugin({
			schemaVersion: 2,
			currentEpisode: clip,
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [clip] },
			downloadedEpisodes: { "local file": [{ ...clip, size: 1 }] },
		});

		await move("Fixtures/A.wav", "Fixtures/B.wav");
		await move("Fixtures/B.wav", "Fixtures/C.wav");
		await plugin.flushSaves();

		const saved = vi.mocked(plugin.saveData).mock.lastCall?.[0] as typeof DEFAULT_SETTINGS;
		const atC = { title: "A", filePath: "Fixtures/C.wav" };
		expect(saved.currentEpisode).toMatchObject(atC);
		expect(saved.downloadedEpisodes["local file"]).toMatchObject([atC]);
		expect(saved.queue.episodes).toMatchObject([atC]);
	});

	it("follows every file of a moved folder", async () => {
		const listed = [registered("Fixtures/Clip One.wav"), registered("Fixtures/Lead.wav")];
		vaultPaths = ["Fixtures/Clip One.wav", "Fixtures/Lead.wav"];
		const plugin = await loadPlugin({
			schemaVersion: 2,
			currentEpisode: listed[1],
			queue: { ...DEFAULT_SETTINGS.queue, episodes: listed },
			downloadedEpisodes: { "local file": listed.map((e) => ({ ...e, size: 1 })) },
		});

		vaultPaths = ["Archive/Clip One.wav", "Archive/Lead.wav"];
		for (const listener of renameListeners) {
			listener(Object.assign(new TFolder(), { path: "Archive" }), "Fixtures");
			listener(vaultFile("Archive/Clip One.wav"), "Fixtures/Clip One.wav");
			listener(vaultFile("Archive/Lead.wav"), "Fixtures/Lead.wav");
		}
		await Promise.resolve();

		const entries = [
			{ title: "Clip One", filePath: "Archive/Clip One.wav" },
			{ title: "Lead", filePath: "Archive/Lead.wav" },
		];
		expect(get(downloadedEpisodes)["local file"]).toMatchObject(entries);
		expect(get(localFiles).episodes).toMatchObject(entries);
		expect(get(queue).episodes).toMatchObject(entries);
		expect(plugin.settings.currentEpisode).toMatchObject(entries[1]);
		expect(get(plugin.player.state).episode).toMatchObject(entries[1]);
	});
});

describe("a tracked file renamed while PodNotes unloads", () => {
	const clip = registered("Fixtures/Clip One.wav");
	const library = () => ({
		schemaVersion: 2,
		currentEpisode: clip,
		queue: { ...DEFAULT_SETTINGS.queue, episodes: [clip] },
		favorites: { ...DEFAULT_SETTINGS.favorites, episodes: [clip] },
		playlists: { Mix: { ...DEFAULT_SETTINGS.favorites, name: "Mix", episodes: [clip] } },
		downloadedEpisodes: { "local file": [{ ...clip, size: 1 }] },
	});

	/**
	 * Obsidian calling the rename listeners it collected before the first one ran, one of
	 * which unloads PodNotes, as a plugin that reloads it does.
	 */
	function renameWhileUnloading(plugin: PodNotes, order: "PodNotes first" | "unload first") {
		const unload: RenameListener = () => {
			loaded.splice(loaded.indexOf(plugin), 1);
			plugin.onunload();
		};
		const listeners =
			order === "unload first" ? [unload, ...renameListeners] : [...renameListeners, unload];
		vaultPaths = ["Fixtures/Changed.wav"];
		for (const listener of listeners) {
			listener(vaultFile("Fixtures/Changed.wav"), "Fixtures/Clip One.wav");
		}
	}

	/** Where each saved list holds the file once a plugin loads what `plugin` saved. */
	async function pathsAfterReload(plugin: PodNotes) {
		await Promise.resolve();
		await plugin.flushSaves();
		const saved = vi.mocked(plugin.saveData).mock.lastCall?.[0] as Record<string, unknown>;
		renameListeners = [];
		const next = await loadPlugin(saved);
		const pathOf = (episode: unknown) => (episode as LocalEpisode).filePath;
		return {
			current: pathOf(next.settings.currentEpisode),
			downloads: get(downloadedEpisodes)["local file"].map(pathOf),
			localFiles: get(localFiles).episodes.map(pathOf),
			queue: get(queue).episodes.map(pathOf),
			favorites: get(favorites).episodes.map(pathOf),
			playlist: get(playlists).Mix.episodes.map(pathOf),
		};
	}

	const everywhere = (path: string) => ({
		current: path,
		downloads: [path],
		localFiles: [path],
		queue: [path],
		favorites: [path],
		playlist: [path],
	});

	it("saves the new path everywhere when PodNotes hears the rename before it unloads", async () => {
		const plugin = await loadPlugin(library());
		await plugin.flushSaves();

		renameWhileUnloading(plugin, "PodNotes first");

		expect(await pathsAfterReload(plugin)).toEqual(everywhere("Fixtures/Changed.wav"));
		const [queued] = get(queue).episodes;
		expect(selectSource(queued, get(downloadedEpisodes), plugin.app.vault).src).toBe(
			"app://resource/Fixtures/Changed.wav",
		);
	});

	it("leaves every saved list at the old path when PodNotes unloads before hearing the rename", async () => {
		const plugin = await loadPlugin(library());
		await plugin.flushSaves();

		renameWhileUnloading(plugin, "unload first");
		await Promise.resolve();

		expect(plugin.settings.currentEpisode).toMatchObject({ filePath: "Fixtures/Clip One.wav" });
		expect(await pathsAfterReload(plugin)).toEqual(everywhere("Fixtures/Clip One.wav"));
	});

	it("follows a path one moved file left and another took, once", async () => {
		const a = registered("Fixtures/A.wav");
		const b = registered("Fixtures/B.wav");
		vaultPaths = ["Fixtures/A.wav", "Fixtures/B.wav"];
		const plugin = await loadPlugin({
			schemaVersion: 2,
			currentEpisode: a,
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [a, b] },
			downloadedEpisodes: { "local file": [a, b].map((e) => ({ ...e, size: 1 })) },
		});
		await plugin.flushSaves();

		vaultPaths = ["Fixtures/B.wav", "Fixtures/C.wav"];
		for (const listener of renameListeners)
			listener(vaultFile("Fixtures/C.wav"), "Fixtures/B.wav");
		for (const listener of renameListeners)
			listener(vaultFile("Fixtures/B.wav"), "Fixtures/A.wav");
		loaded.splice(loaded.indexOf(plugin), 1);
		plugin.onunload();
		await Promise.resolve();
		await plugin.flushSaves();

		const saved = vi.mocked(plugin.saveData).mock.lastCall?.[0] as typeof DEFAULT_SETTINGS;
		const entries = [
			{ title: "A", filePath: "Fixtures/B.wav" },
			{ title: "B", filePath: "Fixtures/C.wav" },
		];
		expect(saved.currentEpisode).toMatchObject(entries[0]);
		expect(saved.downloadedEpisodes["local file"]).toMatchObject(entries);
		expect(saved.queue.episodes).toMatchObject(entries);
	});
});

describe("a vault file PodNotes does not track that is renamed", () => {
	it("asks for no save and writes nothing", async () => {
		const clip = registered("Fixtures/Clip One.wav");
		vaultPaths = ["Fixtures/Clip One.wav", "Notes/Daily.md"];
		const plugin = await loadPlugin({
			schemaVersion: 2,
			currentEpisode: clip,
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [clip] },
			favorites: { ...DEFAULT_SETTINGS.favorites, episodes: [clip] },
			downloadedEpisodes: { "local file": [{ ...clip, size: 960_044 }] },
		});
		await plugin.flushSaves();
		vi.mocked(plugin.saveData).mockClear();
		const saveSettings = vi.spyOn(plugin, "saveSettings");

		await move("Notes/Daily.md", "Notes/Journal.md");
		await plugin.flushSaves();

		expect(saveSettings).not.toHaveBeenCalled();
		expect(plugin.saveData).not.toHaveBeenCalled();
	});
});
