// @vitest-environment jsdom
import { within } from "@testing-library/svelte";
import { get } from "svelte/store";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { App } from "obsidian";
import * as obsidian from "obsidian";

import { DEFAULT_SETTINGS } from "src/constants";
import PodNotes from "src/main";
import { FeedUrlRepository } from "src/services/FeedUrlRepository";
import { favorites, localFiles, playedEpisodes, playlists, queue, savedFeeds } from "src/store";
import { bindStoresToSettings } from "src/store/persistence";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { PodNotesSettingsTab } from "./PodNotesSettingsTab";
import { attachDataFileWriter, dataFileText } from "../../../tests/mocks/dataFileWriter";

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

/** A loaded plugin whose data.json is `disk()`, importing files through the confirm dialog. */
function setup(current: Partial<IPodNotesSettings> = {}) {
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
			disk = structuredClone(snapshot);
		},
	});
	attachDataFileWriter(plugin);
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
		return {
			message: dialog.getByRole("heading").nextElementSibling?.textContent ?? "",
			async confirm() {
				dialog.getByRole("button", { name: "Import" }).click();
				await vi.waitFor(() =>
					expect(notice).toHaveBeenCalledWith("Imported PodNotes settings."),
				);
			},
		};
	}
	return { disk: () => disk as unknown as IPodNotesSettings, chooseFile };
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
		const played = (title: string, time: number) => ({
			title,
			podcastName: "Show",
			time,
			duration: 60,
			finished: false,
		});
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
