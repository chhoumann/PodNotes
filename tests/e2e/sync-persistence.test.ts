import { readFile, rm, writeFile } from "node:fs/promises";
import type { PluginHandle } from "obsidian-e2e";
import { describe, expect, onTestFinished, test } from "vitest";
import type { Episode } from "../../src/types/Episode";
import type { LocalEpisode } from "../../src/types/LocalEpisode";
import type { PodcastFeed } from "../../src/types/PodcastFeed";
import {
	createLocalEpisode,
	createPodNotesE2EHarness,
	evalJsonAsync,
	invokePodNotesUri,
	openPodNotesView,
	type PodNotesData,
	seedAudio,
	waitForPlaybackState,
} from "./harness";
import {
	click,
	closeSettings,
	listedEpisodes,
	openPodNotesSettings,
	showLibrary,
	showPodNotes,
	ui,
} from "./journey/actions";
import { type FixtureFeed, pubDate, startFixtureServer } from "./journey/fixtures";
import { seedLibrary, waitForLibrary } from "./journey/library";
import { jsLiteral, PLUGIN_ID, RELOAD_OPTIONS, WAIT_OPTS, waitForPodNotesReady } from "./runtime";
import { assertNoNewRuntimeErrors } from "./runtime-evidence";

// Obsidian calls Plugin#onExternalSettingsChange when data.json is newer than
// the plugin's last write: Obsidian Sync, iCloud, another instance on the vault,
// a hand edit. plugin.data().patch() writes the file from outside Obsidian, like
// those do.
const getContext = createPodNotesE2EHarness("sync-persistence");
const POLL = { timeout: WAIT_OPTS.timeoutMs, interval: WAIT_OPTS.intervalMs };

const SYNCED_FEED: PodcastFeed = {
	title: "Synced Feed",
	url: "https://example.com/synced.xml",
	// Inline artwork: the grid hides a podcast whose artwork fails to load.
	artworkUrl:
		"data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22%3E%3Crect width=%2210%22 height=%2210%22 fill=%22%23f59e0b%22/%3E%3C/svg%3E",
};
const SYNCED_PROGRESS = {
	title: "Synced Episode",
	podcastName: "Synced Podcast",
	time: 1234,
	duration: 3600,
	finished: false,
};

type Memory = {
	feed: boolean;
	playlist: boolean;
	progress: number | null;
	volume: number;
	queue: string[];
};

const MEMORY = `(() => {
	const settings = app.plugins.plugins.${PLUGIN_ID}.settings;
	return {
		feed: "Synced Feed" in settings.savedFeeds,
		playlist: "Synced Playlist" in settings.playlists,
		progress: settings.playedEpisodes["Synced Podcast::Synced Episode"]?.time ?? null,
		volume: settings.defaultVolume,
		queue: settings.queue.episodes.map((episode) => episode.podcastName + " / " + episode.title),
	};
})()`;

function addSyncedChanges(data: PodNotesData): void {
	data.savedFeeds = { ...data.savedFeeds, [SYNCED_FEED.title]: SYNCED_FEED };
	data.playlists = {
		...data.playlists,
		"Synced Playlist": {
			icon: "list",
			name: "Synced Playlist",
			episodes: [],
			shouldEpisodeRemoveAfterPlay: false,
			shouldRepeat: false,
		},
	};
	data.playedEpisodes = {
		...data.playedEpisodes,
		"Synced Podcast::Synced Episode": SYNCED_PROGRESS,
	};
}

function setVolume(obsidian: Parameters<typeof evalJsonAsync>[0], volume: number) {
	return obsidian.dev.evalJson(
		`(() => { app.plugins.plugins.${PLUGIN_ID}.api.volume = ${volume}; return true; })()`,
	);
}

function queueOf(episodes: Episode[]) {
	return {
		icon: "list-ordered" as const,
		name: "Queue",
		episodes,
		shouldEpisodeRemoveAfterPlay: true,
		shouldRepeat: false,
	};
}

async function seedLocalEpisode(
	plugin: PluginHandle,
	episode: LocalEpisode,
	queue: Episode[] = [],
): Promise<void> {
	await plugin.updateDataAndReload<PodNotesData>((data) => {
		data.currentEpisode = undefined;
		data.defaultVolume = 1;
		data.downloadedEpisodes = {
			[episode.podcastName]: [{ ...episode, filePath: episode.streamUrl, size: 1 }],
		};
		data.playedEpisodes = {};
		data.queue = queueOf(queue);
	}, RELOAD_OPTIONS);
}

describe("PodNotes data.json changed elsewhere", () => {
	test("applies the change without a reload and keeps it through the next local save", async () => {
		const { obsidian, plugin } = getContext();
		await openPodNotesView(obsidian);

		await plugin.data<PodNotesData>().patch(addSyncedChanges);

		await expect
			.poll(() => obsidian.dev.evalJson<Memory>(MEMORY), POLL)
			.toMatchObject({ feed: true, playlist: true, progress: 1234 });
		await showLibrary(obsidian);
		await expect
			.poll(
				() =>
					obsidian.dev.evalJson<boolean>(
						`Boolean(document.querySelector('.podcast-view .podcast-card[aria-label="Synced Feed"]'))`,
					),
				POLL,
			)
			.toBe(true);

		await setVolume(obsidian, 0.42);
		const disk = await plugin.waitForData<PodNotesData>(
			(data) => data.defaultVolume === 0.42,
			WAIT_OPTS,
		);
		expect(disk.savedFeeds?.[SYNCED_FEED.title]).toEqual(SYNCED_FEED);
		expect(disk.playlists?.["Synced Playlist"]).toBeDefined();
		expect(disk.playedEpisodes?.["Synced Podcast::Synced Episode"]).toEqual(SYNCED_PROGRESS);
	});

	test("keeps an edit made here that was not saved yet when another device's change lands", async () => {
		const { obsidian, plugin } = getContext();
		await setVolume(obsidian, 0.32);
		await plugin.waitForData<PodNotesData>((data) => data.defaultVolume === 0.32, WAIT_OPTS);

		// A change saves at once, but a playback checkpoint waits up to 10 s after the
		// last save. This edit stands in for one.
		await obsidian.dev.evalJson(`(() => {
			const podnotes = app.plugins.plugins.${PLUGIN_ID};
			podnotes.checkpoint(() => { podnotes.api.volume = 0.33; });
			return true;
		})()`);
		await plugin.data<PodNotesData>().patch(addSyncedChanges);

		await expect
			.poll(() => obsidian.dev.evalJson<Memory>(MEMORY), POLL)
			.toMatchObject({ feed: true, progress: 1234, volume: 0.33 });
		const disk = await plugin.waitForData<PodNotesData>(
			(data) => data.defaultVolume === 0.33 && Boolean(data.savedFeeds?.[SYNCED_FEED.title]),
			WAIT_OPTS,
		);
		expect(disk.playedEpisodes?.["Synced Podcast::Synced Episode"]).toEqual(SYNCED_PROGRESS);
	});

	test("leaves the playing episode, its position and the queue alone", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(obsidian, sandbox);
		const episode = createLocalEpisode("E2E Sync Playing Episode", audioPath);
		const queued = createLocalEpisode("E2E Sync Queued Episode", sandbox.path("queued.mp3"));
		await seedLocalEpisode(plugin, episode, [queued]);
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);
		await invokePodNotesUri(obsidian, episode, 5);
		const before = await waitForPlaybackState(
			obsidian,
			(state) =>
				state.hasPlayer &&
				state.title === episode.title &&
				state.isPlaying &&
				(state.currentTime ?? 0) > 6,
		);

		// Another device adds a feed and switches its own player to another episode.
		await plugin.data<PodNotesData>().patch((data) => {
			data.savedFeeds = { ...data.savedFeeds, [SYNCED_FEED.title]: SYNCED_FEED };
			data.currentEpisode = queued;
		});
		await expect
			.poll(() => obsidian.dev.evalJson<Memory>(MEMORY), POLL)
			.toMatchObject({ feed: true, queue: ["local file / E2E Sync Queued Episode"] });
		// The selection follows the other device; what plays here stays.
		expect(
			await obsidian.dev.evalJson<string | null>(
				`app.plugins.plugins.${PLUGIN_ID}.settings.currentEpisode?.title ?? null`,
			),
		).toBe(queued.title);

		const after = await waitForPlaybackState(
			obsidian,
			(state) => (state.currentTime ?? 0) > (before.currentTime ?? 0) + 1,
		);
		expect(after).toMatchObject({ title: episode.title, isPlaying: true });
		const disk = await plugin.waitForData<PodNotesData>(
			(data) =>
				Boolean(data.savedFeeds?.[SYNCED_FEED.title]) &&
				(data.playedEpisodes?.[`local file::${episode.title}`]?.time ?? 0) >=
					(before.currentTime ?? 0),
			WAIT_OPTS,
		);
		expect(disk.queue?.episodes.map((item) => item.title)).toEqual([queued.title]);
		expect(disk.currentEpisode?.title).toBe(queued.title);
	});

	test("does not treat its own saves as external changes", async () => {
		const { obsidian, plugin } = getContext();
		// The harness rewrites data.json before each test, which is a change made
		// elsewhere. Let Obsidian report it before counting.
		await obsidian.sleep(2_500);
		await obsidian.dev.evalJson(`(() => {
			const podnotes = app.plugins.plugins.${PLUGIN_ID};
			const original = podnotes.onExternalSettingsChange;
			window.__podnotesExternalChanges = 0;
			podnotes.onExternalSettingsChange = function () {
				window.__podnotesExternalChanges++;
				return original?.call(this);
			};
			return true;
		})()`);

		await setVolume(obsidian, 0.55);
		await plugin.waitForData<PodNotesData>((data) => data.defaultVolume === 0.55, WAIT_OPTS);
		// Obsidian debounces its file watcher; give it well past that to call in.
		await obsidian.sleep(2_500);

		expect(await obsidian.dev.evalJson<number>("window.__podnotesExternalChanges")).toBe(0);
	});

	test("saves an unsaved edit and keeps the change made elsewhere when disabled during their read", async () => {
		const { obsidian, plugin } = getContext();
		const dataPath = await plugin.dataPath();
		// A write through the harness first, so it restores this file after the test.
		await plugin.data<PodNotesData>().patch((data) => data);

		const disk = await evalJsonAsync<PodNotesData>(
			obsidian,
			`(async () => {
				const podnotes = app.plugins.plugins.${PLUGIN_ID};
				const path = podnotes.manifest.dir + "/data.json";
				const data = JSON.parse(await app.vault.adapter.read(path));
				data.savedFeeds[${jsLiteral(SYNCED_FEED.title)}] = ${jsLiteral(SYNCED_FEED)};
				let release;
				const held = new Promise((resolve) => { release = resolve; });
				const read = podnotes.loadData.bind(podnotes);
				podnotes.loadData = () => held.then(read);
				try {
					await app.vault.adapter.write(path, JSON.stringify(data));
					podnotes.api.volume = 0.27;
					void podnotes.onExternalSettingsChange?.();
					await app.plugins.disablePlugin(${jsLiteral(PLUGIN_ID)});
					release();
					await podnotes.flushSaves();
					return JSON.parse(await app.vault.adapter.read(path));
				} finally {
					release();
					await app.plugins.enablePlugin(${jsLiteral(PLUGIN_ID)});
				}
			})()`,
		);
		await waitForPodNotesReady(obsidian);

		expect(disk.savedFeeds?.[SYNCED_FEED.title]).toEqual(SYNCED_FEED);
		expect(disk.defaultVolume).toBe(0.27);
		expect(JSON.parse(await readFile(dataPath, "utf8")).defaultVolume).toBe(0.27);
	});

	test("adopts data.json once it becomes readable after a start that could not read it", async () => {
		const { obsidian, plugin } = getContext();
		const original = await plugin.data<PodNotesData>().read();
		const dataPath = await plugin.dataPath();

		await plugin.disable();
		await plugin.data<PodNotesData>().write(original);
		const text = await readFile(dataPath, "utf8");
		await writeFile(dataPath, text.slice(0, Math.floor(text.length / 2)));
		try {
			await plugin.enable();
			await waitForPodNotesReady(obsidian);
			expect(await obsidian.dev.notices()).toContainEqual(
				expect.objectContaining({
					message: expect.stringContaining("PodNotes could not read"),
				}),
			);

			const synced = structuredClone(original);
			addSyncedChanges(synced);
			await writeFile(dataPath, JSON.stringify(synced));

			await expect
				.poll(() => obsidian.dev.evalJson<Memory>(MEMORY), POLL)
				.toMatchObject({ feed: true, progress: 1234 });
			await expect
				.poll(
					() =>
						obsidian.dev.evalJson<boolean>(
							`[...document.querySelectorAll(".notice")].some((notice) => notice.textContent?.includes("PodNotes could not read"))`,
						),
					POLL,
				)
				.toBe(false);
			await setVolume(obsidian, 0.61);
			const disk = await plugin.waitForData<PodNotesData>(
				(data) => data.defaultVolume === 0.61,
				WAIT_OPTS,
			);
			expect(disk.savedFeeds?.[SYNCED_FEED.title]).toEqual(SYNCED_FEED);
		} finally {
			await plugin.data<PodNotesData>().write(original);
			await plugin.reload(RELOAD_OPTIONS);
			await obsidian.dev.evalJson(`(() => {
				for (const notice of document.querySelectorAll(".notice")) {
					if (notice.textContent?.includes("PodNotes could not read")) notice.remove();
				}
				return true;
			})()`);
		}
	});

	async function startAsNewDevice(plugin: PluginHandle): Promise<PodNotesData> {
		// A write through the harness first, so it restores this file after the test.
		await plugin.data<PodNotesData>().patch((data) => data);
		await rm(await plugin.dataPath());
		await plugin.reload(RELOAD_OPTIONS);
		const file = await plugin.data<PodNotesData & { libraryId?: string }>().read();
		expect(file.savedFeeds).toEqual({});
		expect(file.libraryId).toMatch(/^\d{4}-/);
		return file;
	}

	test("keeps its library when a new device's file replaces data.json", async () => {
		const { obsidian, plugin } = getContext();
		const library = await plugin.data<PodNotesData>().read();
		addSyncedChanges(library);
		const newDeviceFile = await startAsNewDevice(plugin);
		await plugin.data<PodNotesData>().write(library);
		await plugin.reload(RELOAD_OPTIONS);

		await plugin.data<PodNotesData>().write(newDeviceFile);

		const disk = await plugin.waitForData<PodNotesData>(
			(data) => Boolean(data.savedFeeds?.[SYNCED_FEED.title]),
			WAIT_OPTS,
		);
		expect(disk.playedEpisodes?.["Synced Podcast::Synced Episode"]).toEqual(SYNCED_PROGRESS);
		expect(await obsidian.dev.evalJson<Memory>(MEMORY)).toMatchObject({
			feed: true,
			playlist: true,
			progress: 1234,
		});
	});

	test("keeps a new device's change when the library replaces its data.json", async () => {
		const { obsidian, plugin } = getContext();
		const library = await plugin.data<PodNotesData>().read();
		addSyncedChanges(library);
		await startAsNewDevice(plugin);
		await setVolume(obsidian, 0.42);
		await plugin.waitForData<PodNotesData>((data) => data.defaultVolume === 0.42, WAIT_OPTS);

		await plugin.data<PodNotesData>().write(library);

		const disk = await plugin.waitForData<PodNotesData>(
			(data) => data.defaultVolume === 0.42 && Boolean(data.savedFeeds?.[SYNCED_FEED.title]),
			WAIT_OPTS,
		);
		expect(disk.playedEpisodes?.["Synced Podcast::Synced Episode"]).toEqual(SYNCED_PROGRESS);
		expect(await obsidian.dev.evalJson<Memory>(MEMORY)).toMatchObject({
			feed: true,
			playlist: true,
			progress: 1234,
			volume: 0.42,
		});
	});

	test("shows both names when the library saved a podcast under an earlier name than a new device", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const current: FixtureFeed = {
			title: "Current Show Name",
			slug: "renamed-show",
			artwork: true,
			episodes: [{ title: "Renamed Show Episode", seconds: 6, pubDate: pubDate(0) }],
		};
		const earlier: FixtureFeed = { ...current, title: "Earlier Show Name" };
		const server = await startFixtureServer([current]);
		onTestFinished(() => server.stop());
		onTestFinished(() => closeSettings(obsidian));
		await seedLibrary(context, server, { subscriptions: [earlier] });
		const library = await plugin.data<PodNotesData>().read();
		const newDeviceFile = await startAsNewDevice(plugin);
		newDeviceFile.savedFeeds = {
			[current.title]: {
				title: current.title,
				url: server.feedUrl(current),
				artworkUrl: server.artworkUrl(current),
			},
		};
		await plugin.data<PodNotesData>().write(library);
		await plugin.reload(RELOAD_OPTIONS);

		await plugin.data<PodNotesData>().write(newDeviceFile);

		const merged = await waitForLibrary(
			plugin,
			(saved) => saved.subscriptions.length === 2,
			"both names of the podcast saved",
		);
		expect(merged.subscriptions.map((feed) => feed.url)).toEqual([
			server.feedUrl(current),
			server.feedUrl(current),
		]);
		await showPodNotes(obsidian);
		for (const title of [earlier.title, current.title]) {
			await showLibrary(obsidian);
			await click(obsidian, ui.podcastCard(title));
			await obsidian.waitFor(async () => (await listedEpisodes(obsidian)).length > 0, {
				timeoutMs: 15_000,
				message: `the episodes of ${title}`,
			});
			expect(await listedEpisodes(obsidian)).toEqual(["Renamed Show Episode"]);
		}
		await openPodNotesSettings(obsidian);
		await assertNoNewRuntimeErrors(obsidian);
	});
});

describe("PodNotes queue identity", () => {
	test("keeps same-titled episodes from two podcasts queued, and playing one keeps the other (#356)", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(obsidian, sandbox);
		const local = createLocalEpisode("Trailer", audioPath);
		const other: Episode = {
			title: "Trailer",
			podcastName: "Other Podcast",
			streamUrl: "https://example.com/other/trailer.mp3",
			url: "https://example.com/other/trailer",
			description: "",
			content: "",
		};
		await seedLocalEpisode(plugin, local, [local, other]);
		await waitForPodNotesReady(obsidian);

		expect((await obsidian.dev.evalJson<Memory>(MEMORY)).queue).toEqual([
			"local file / Trailer",
			"Other Podcast / Trailer",
		]);

		await openPodNotesView(obsidian);
		await invokePodNotesUri(obsidian, local, 1);
		await waitForPlaybackState(obsidian, (state) => state.title === local.title);

		await expect
			.poll(() => obsidian.dev.evalJson<Memory>(MEMORY), POLL)
			.toMatchObject({ queue: ["Other Podcast / Trailer"] });
		const disk = await plugin.waitForData<PodNotesData>(
			(data) => data.queue?.episodes.length === 1,
			WAIT_OPTS,
		);
		expect(disk.queue?.episodes[0]).toMatchObject({ podcastName: "Other Podcast" });
	});
});
