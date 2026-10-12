// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { TFile, type TAbstractFile } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import PodNotes from "./main";
import { selectSource } from "./player/source";
import { downloadedEpisodes, favorites, localFiles, playedEpisodes, queue } from "./store";
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

describe("a vault file PodNotes tracks that is renamed or moved", () => {
	it("takes the local file's new name and keeps its progress", async () => {
		const clip = registered("Fixtures/Clip One.wav");
		vaultPaths = ["Fixtures/Clip One.wav"];
		await loadPlugin({
			schemaVersion: 2,
			downloadedEpisodes: { "local file": [{ ...clip, size: 960_044 }] },
			playedEpisodes: {
				"local file::Clip One": {
					title: "Clip One",
					podcastName: "local file",
					time: 42,
					duration: 600,
					finished: false,
				},
			},
		});

		move("Fixtures/Clip One.wav", "Fixtures/Intro.wav");

		const entry = { title: "Intro", filePath: "Fixtures/Intro.wav" };
		expect(get(downloadedEpisodes)["local file"]).toMatchObject([entry]);
		expect(get(localFiles).episodes).toMatchObject([entry]);
		expect(get(playedEpisodes)["local file::Intro"]).toMatchObject({
			title: "Intro",
			time: 42,
		});
		expect(get(playedEpisodes)).not.toHaveProperty(["local file::Clip One"]);
	});

	it.each(["local file", ""])(
		"moves the local file's legacy title-only progress (podcast %j) to its new name and keeps another podcast's",
		async (podcastName) => {
			const clip = registered("Fixtures/Clip One.wav");
			vaultPaths = ["Fixtures/Clip One.wav"];
			const progress = { duration: 600, finished: false };
			const otherShow = {
				title: "Clip One",
				podcastName: "Other Show",
				time: 7,
				...progress,
			};
			await loadPlugin({
				schemaVersion: 2,
				downloadedEpisodes: { "local file": [{ ...clip, size: 960_044 }] },
				playedEpisodes: {
					"Clip One": { title: "Clip One", podcastName, time: 42, ...progress },
					"Other Show::Clip One": otherShow,
				},
			});

			move("Fixtures/Clip One.wav", "Fixtures/Intro.wav");

			expect(get(playedEpisodes)).toEqual({
				"local file::Intro": {
					title: "Intro",
					podcastName: "local file",
					time: 42,
					...progress,
				},
				"Other Show::Clip One": otherShow,
			});
		},
	);

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

		move("PodNotes/Show/Ep 1.mp3", "Archive/Ep 1.mp3");

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

		move("Fixtures/Clip One.wav", "Fixtures/A/Clip One.wav");

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

	it("takes over the name of another tracked local file, with a notice", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vaultPaths = ["Fixtures/Clip One.wav", "Fixtures/Lead.wav"];
		await loadPlugin({
			schemaVersion: 2,
			downloadedEpisodes: {
				"local file": [
					{ ...registered("Fixtures/Clip One.wav"), size: 1 },
					{ ...registered("Fixtures/Lead.wav"), size: 2 },
				],
			},
		});

		move("Fixtures/Lead.wav", "Archive/Clip One.wav");

		const entry = { title: "Clip One", filePath: "Archive/Clip One.wav", size: 2 };
		expect(get(downloadedEpisodes)["local file"]).toMatchObject([entry]);
		expect(get(localFiles).episodes).toMatchObject([entry]);
		expect(notice).toHaveBeenCalledWith(
			'A local file named "Clip One" was already tracked at "Fixtures/Clip One.wav". It has been replaced by "Archive/Clip One.wav".',
		);
	});

	it.each([
		["with it listed first", ["Fixtures/Clip One.wav", "Fixtures/Lead.wav"]],
		["with it listed second", ["Fixtures/Lead.wav", "Fixtures/Clip One.wav"]],
	])(
		"takes over the queue and favorites entries of the tracked file whose name it takes, %s",
		async (_, paths) => {
			const listed = paths.map((path) => registered(path));
			vaultPaths = ["Fixtures/Clip One.wav", "Fixtures/Lead.wav"];
			await loadPlugin({
				schemaVersion: 2,
				queue: { ...DEFAULT_SETTINGS.queue, episodes: listed },
				favorites: { ...DEFAULT_SETTINGS.favorites, episodes: listed },
				downloadedEpisodes: { "local file": listed.map((e) => ({ ...e, size: 1 })) },
			});

			move("Fixtures/Lead.wav", "Archive/Clip One.wav");

			const entry = { title: "Clip One", filePath: "Archive/Clip One.wav" };
			expect(get(queue).episodes).toMatchObject([entry]);
			expect(get(favorites).episodes).toMatchObject([entry]);
		},
	);
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

		move("Notes/Daily.md", "Notes/Journal.md");
		await plugin.flushSaves();

		expect(saveSettings).not.toHaveBeenCalled();
		expect(plugin.saveData).not.toHaveBeenCalled();
	});
});
