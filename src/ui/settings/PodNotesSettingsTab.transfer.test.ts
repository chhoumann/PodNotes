// @vitest-environment jsdom
import { within } from "@testing-library/svelte";
import { get } from "svelte/store";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { App } from "obsidian";
import * as obsidian from "obsidian";

import { DEFAULT_SETTINGS } from "src/constants";
import PodNotes from "src/main";
import { PlayerController } from "src/player/PlayerController";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { favorites, localFiles, playedEpisodes, playlists, queue, savedFeeds } from "src/store";
import { bindStoresToSettings } from "src/store/persistence";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { PodNotesSettingsTab } from "./PodNotesSettingsTab";
import { attachDataFileWriter, dataFileText } from "../../../tests/mocks/dataFileWriter";
import { FakeDocument } from "../../../tests/mocks/fakeMedia";

const privateUrl = "https://private.example/feed.xml?auth=s3cret";

function episode(podcastName: string, title: string, feedUrl?: string) {
	return {
		title,
		streamUrl: `https://media.example/${title}.mp3`,
		url: "",
		description: "",
		content: "",
		podcastName,
		...(feedUrl ? { feedUrl } : {}),
		episodeDate: "2026-10-09T09:00:00.000Z",
	};
}

function played(title: string, time: number) {
	return { title, podcastName: "Show", time, duration: 60, finished: false };
}

function setup(
	current: Partial<IPodNotesSettings> = {},
	beforeWrite: (write: number) => Promise<void> = async () => {},
) {
	let writes = 0;
	const settings = { ...structuredClone(DEFAULT_SETTINGS), ...structuredClone(current) };
	let disk: Record<string, unknown> = { ...structuredClone(settings), schemaVersion: 2 };
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin, {
		settings,
		credentials: { storeValues: vi.fn(() => ({})) },
		feedUrls: new FeedUrlRepository(new obsidian.SecretStorage()),
		isReady: true,
		persistenceUnknownFields: {},
		app: {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(true),
					read: vi.fn(async () => dataFileText(disk)),
				},
			},
		},
		manifest: { dir: ".obsidian/plugins/podnotes" },
		loadData: vi.fn(async () => structuredClone(disk)),
		saveData: async (snapshot: Record<string, unknown>) => {
			await beforeWrite(++writes);
			disk = structuredClone(snapshot);
		},
	});
	attachDataFileWriter(plugin);
	plugin.player = new PlayerController(new FakeDocument().asPlayerDocument(), plugin);
	savedFeeds.set(settings.savedFeeds);
	playedEpisodes.set(settings.playedEpisodes);
	playlists.set(settings.playlists);
	queue.set(settings.queue);
	favorites.set(settings.favorites);
	localFiles.set(settings.localFiles);
	onTestFinished(bindStoresToSettings(plugin));
	const tab = new PodNotesSettingsTab({} as App, plugin);
	vi.spyOn(tab, "update").mockImplementation(() => {});
	const notice = vi.spyOn(obsidian, "Notice");
	onTestFinished(() => notice.mockRestore());

	function chooseFile(contents: unknown) {
		(tab as unknown as { handleSettingsImport(contents: string): void }).handleSettingsImport(
			JSON.stringify(contents),
		);
		const dialog = within(document.body.lastElementChild as HTMLElement);
		const click = () => dialog.getByRole("button", { name: "Import" }).click();
		return {
			message: dialog.getByRole("heading").nextElementSibling?.textContent ?? "",
			click,
			async confirm() {
				click();
				await vi.waitFor(() =>
					expect(notice).toHaveBeenCalledWith("Imported PodNotes settings."),
				);
			},
		};
	}
	const sync = (change: Partial<IPodNotesSettings>) =>
		Object.assign(disk, structuredClone(change));
	return { plugin, notice, sync, disk: () => disk as unknown as IPodNotesSettings, chooseFile };
}

describe("importing a settings file", () => {
	it("never writes a private feed URL from an imported data.json, even in episode snapshots", async () => {
		const { disk, chooseFile } = setup();
		const privateEpisode = episode("Private", "Private Episode", privateUrl);

		await chooseFile({
			...structuredClone(DEFAULT_SETTINGS),
			schemaVersion: 2,
			savedFeeds: { Private: { title: "Private", url: privateUrl, artworkUrl: "" } },
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [privateEpisode] },
			favorites: { ...DEFAULT_SETTINGS.favorites, episodes: [privateEpisode] },
			playlists: {
				Trip: { ...DEFAULT_SETTINGS.queue, name: "Trip", episodes: [privateEpisode] },
			},
		}).confirm();

		expect(JSON.stringify(disk())).not.toContain("s3cret");
		expect(disk().savedFeeds.Private.url).toBe("podnotes-private-feed:Private");
		expect(disk().queue.episodes[0].feedUrl).toBe("podnotes-private-feed:Private");
	});

	it("protects a private feed that another device synced while the import was saving", async () => {
		const { disk, sync, chooseFile } = setup();
		sync({
			savedFeeds: { Synced: { title: "Synced", url: privateUrl, artworkUrl: "" } },
			queue: {
				...DEFAULT_SETTINGS.queue,
				episodes: [episode("Synced", "Ep", privateUrl) as never],
			},
		});

		await chooseFile({
			...structuredClone(DEFAULT_SETTINGS),
			schemaVersion: 2,
			defaultVolume: 0.5,
		}).confirm();

		expect(JSON.stringify(disk())).not.toContain("s3cret");
		expect(disk().savedFeeds.Synced.url).toBe("podnotes-private-feed:Synced");
		expect(disk().queue.episodes[0].feedUrl).toBe("podnotes-private-feed:Synced");
	});

	it("imports other settings and keeps a failed private-address move for this session", async () => {
		const { plugin, notice, disk, chooseFile } = setup();
		const setSecret = vi
			.spyOn(obsidian.SecretStorage.prototype, "setSecret")
			.mockImplementation(() => {
				throw new Error("locked");
			});
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		onTestFinished(() => {
			setSecret.mockRestore();
			consoleError.mockRestore();
		});

		await chooseFile({
			...structuredClone(DEFAULT_SETTINGS),
			schemaVersion: 2,
			defaultVolume: 0.4,
			savedFeeds: { Private: { title: "Private", url: privateUrl, artworkUrl: "" } },
		}).confirm();

		expect(notice).toHaveBeenCalledWith(
			"Could not store the private feed address on this device.",
		);
		expect(disk().defaultVolume).toBe(0.4);
		expect(disk().savedFeeds.Private.url).toBe("podnotes-private-feed:Private");
		expect(JSON.stringify(disk())).not.toContain("s3cret");
		expect(plugin.feedUrls.resolve(disk().savedFeeds.Private.urlSecretId ?? "")).toBe(
			privateUrl,
		);
	});

	it("never writes a private feed URL that an older build left in the imported file", async () => {
		const { disk, chooseFile } = setup();
		const leaked = episode("Private", "Private Episode", privateUrl);

		await chooseFile({
			...structuredClone(DEFAULT_SETTINGS),
			schemaVersion: 2,
			savedFeeds: {
				Private: {
					title: "Private",
					url: "podnotes-private-feed:Private",
					urlSecretId: "podnotes-feed-url-00000000-0000-4000-8000-000000000000",
					artworkUrl: "",
				},
			},
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [leaked] },
		}).confirm();

		expect(JSON.stringify(disk())).not.toContain("s3cret");
		expect(disk().queue.episodes[0].feedUrl).toBe("podnotes-private-feed:Private");
	});

	it("keeps this vault's local files and never brings another vault's", async () => {
		const mine = { ...episode("local file", "Mine"), filePath: "Audio/Mine.mp3" };
		const theirs = { ...episode("local file", "Theirs"), filePath: "Elsewhere/Theirs.mp3" };
		const theirShow = episode("Show", "Their Episode");
		const { disk, chooseFile } = setup({
			localFiles: { ...DEFAULT_SETTINGS.localFiles, episodes: [mine] as never },
		});

		await chooseFile({
			...structuredClone(DEFAULT_SETTINGS),
			schemaVersion: 2,
			localFiles: { ...DEFAULT_SETTINGS.localFiles, episodes: [theirs] },
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [theirs, theirShow] },
			favorites: { ...DEFAULT_SETTINGS.favorites, episodes: [theirs] },
		}).confirm();

		expect(JSON.stringify(disk())).not.toContain("Theirs");
		expect(disk().localFiles.episodes.map(({ title }) => title)).toEqual(["Mine"]);
		expect(get(localFiles).episodes.map(({ title }) => title)).toEqual(["Mine"]);
		expect(disk().queue.episodes.map(({ title }) => title)).toEqual(["Their Episode"]);
	});

	it("brings progress for episodes this vault has not played and keeps its own", async () => {
		const { disk, chooseFile } = setup({
			playedEpisodes: { "Show::Ep 1": played("Ep 1", 10) },
		});

		await chooseFile({
			...structuredClone(DEFAULT_SETTINGS),
			schemaVersion: 2,
			playedEpisodes: {
				"Show::Ep 1": played("Ep 1", 50),
				"Show::Ep 2": played("Ep 2", 20),
			},
		}).confirm();

		const expected = { "Show::Ep 1": played("Ep 1", 10), "Show::Ep 2": played("Ep 2", 20) };
		expect(disk().playedEpisodes).toEqual(expected);
		expect(get(playedEpisodes)).toEqual(expected);
	});

	it("keeps imported progress when the player saves a position during the import", async () => {
		let releaseFirstWrite = () => {};
		const firstWrite = new Promise<void>((resolve) => (releaseFirstWrite = resolve));
		let writing = false;
		const { disk, chooseFile } = setup(
			{ playedEpisodes: { "Show::Ep 1": played("Ep 1", 10) } },
			async (write) => {
				writing = true;
				if (write === 1) await firstWrite;
			},
		);

		const importing = chooseFile({
			...structuredClone(DEFAULT_SETTINGS),
			schemaVersion: 2,
			playedEpisodes: { "Show::Ep 2": played("Ep 2", 20) },
		}).confirm();
		await vi.waitFor(() => expect(writing).toBe(true));
		playedEpisodes.setEpisodeTime(episode("Show", "Ep 1") as never, 15, 60, false);
		releaseFirstWrite();
		await importing;

		const expected = { "Show::Ep 1": played("Ep 1", 15), "Show::Ep 2": played("Ep 2", 20) };
		expect(get(playedEpisodes)).toEqual(expected);
		expect(disk().playedEpisodes).toEqual(expected);
	});

	it("names the queue and favorites it replaces before importing", () => {
		const { chooseFile } = setup({
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [episode("Show", "Queued")] as never },
			favorites: {
				...DEFAULT_SETTINGS.favorites,
				episodes: [episode("Show", "Loved")] as never,
			},
		});

		const { message } = chooseFile({
			queue: { ...DEFAULT_SETTINGS.queue, episodes: [] },
			favorites: { ...DEFAULT_SETTINGS.favorites, episodes: [] },
		});

		expect(message).toContain("Also replaced: queue, favorites.");
	});
});
