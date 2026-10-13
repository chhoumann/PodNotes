import fs from "node:fs/promises";
import path from "node:path";
import type { ObsidianClient, PluginHandle, SandboxApi } from "obsidian-e2e";
import e2eConfig from "../../../obsidian-e2e.config.mjs";
import { jsLiteral, PLUGIN_ID, RELOAD_OPTIONS, VIEW_TYPE } from "../runtime";
import { collectRuntimeErrors } from "../runtime-evidence";
import { assertSingleWindow, dismissNotices, setMobileEmulation } from "./actions";
import type { FixtureEpisode, FixtureFeed, FixtureServer } from "./fixtures";

export type EpisodeRef = Readonly<{ podcast: string; title: string }>;

export type PlaybackObservation = Readonly<{
	episode: EpisodeRef | null;
	playing: boolean;
	seconds: number;
	duration: number | null;
	media: Readonly<{ src: string; paused: boolean; seconds: number }> | null;
}>;

export type SavedProgress = Readonly<{ seconds: number; duration: number; finished: boolean }>;

export type SavedLibrary = Readonly<{
	subscriptions: ReadonlyArray<Readonly<{ title: string; url: string }>>;
	currentEpisode: EpisodeRef | null;
	queue: readonly string[];
	playlists: Readonly<Record<string, readonly string[]>>;
	localFiles: ReadonlyArray<Readonly<{ title: string; filePath: string }>>;
	downloads: ReadonlyArray<Readonly<{ podcast: string; title: string; filePath: string }>>;
	skipBackwardSeconds: number;
	progress(episode: EpisodeRef): SavedProgress | undefined;
}>;

export type StoredEpisode = Readonly<
	Record<string, unknown> & { title: string; podcastName: string }
>;

export type LibrarySeed = Readonly<{
	subscriptions?: readonly FixtureFeed[];
	current?: StoredEpisode;
	queue?: readonly StoredEpisode[];
	playlists?: ReadonlyArray<{
		name: string;
		removeAfterPlay: boolean;
		episodes: readonly StoredEpisode[];
	}>;
	progress?: ReadonlyArray<{
		episode: StoredEpisode;
		seconds: number;
		duration: number;
		finished: boolean;
	}>;
	openAISecretId?: string;
	transcriptTemplate?: string;
}>;

type JourneyContext = Readonly<{
	obsidian: ObsidianClient;
	plugin: PluginHandle;
	sandbox: SandboxApi;
}>;
type Json = Record<string, any>;

const FEED_CACHE_KEY = "podnotes:feed-cache:v6";

type JourneySnapshot = Readonly<{
	cache: unknown;
	layout: Record<string, unknown>;
	recentFiles: readonly string[];
	mobile: boolean;
	size: [number, number];
	corePlugins: Record<string, boolean>;
	coreConfig: Record<string, unknown>;
	workspaceFiles: ReadonlyArray<{ path: string; bytes: Buffer | null }>;
}>;

const snapshots = new WeakMap<ObsidianClient, JourneySnapshot>();

export async function snapshotJourneyState(obsidian: ObsidianClient): Promise<void> {
	if (snapshots.has(obsidian)) throw new Error("Journey state was not restored.");
	const runtime = await obsidian.dev.evalJson<Omit<JourneySnapshot, "workspaceFiles">>(`({
		cache: app.loadLocalStorage(${jsLiteral(FEED_CACHE_KEY)}),
		layout: app.workspace.getLayout(),
		recentFiles: app.workspace.recentFileTracker.serialize(),
		mobile: app.isMobile,
		size: electronWindow.getSize(),
		corePlugins: Object.fromEntries(Object.entries(app.internalPlugins.plugins).map(([id, plugin]) => [id, plugin.enabled])),
		coreConfig: structuredClone(app.internalPlugins.config),
	})`);
	const vault = await obsidian.vaultPath();
	const workspaceFiles = await Promise.all(
		["workspace.json", "workspace-mobile.json", "core-plugins.json"].map(async (name) => {
			const filePath = path.join(vault, ".obsidian", name);
			const bytes = await fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
				return null;
			});
			return { path: filePath, bytes };
		}),
	);
	snapshots.set(obsidian, { ...runtime, workspaceFiles });
}

export async function normalizeJourneyLayout(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		const left = app.workspace.leftSplit;
		if (app.isMobile || (!left.collapsed && left.size >= 200)) return true;
		left.expand();
		left.setSize(280);
		app.workspace.requestSaveLayout.cancel();
		await app.workspace.saveLayout();
		await app.vault.adapter.promise;
		return true;
	})()`);
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				"app.isMobile || app.workspace.leftSplit.containerEl.getBoundingClientRect().width >= 200",
			),
		{ timeoutMs: 10_000, intervalMs: 100, message: "the left sidebar open" },
	);
}

export function hasJourneySnapshot(obsidian: ObsidianClient): boolean {
	return snapshots.has(obsidian);
}

export async function restoreJourneyCache(obsidian: ObsidianClient): Promise<void> {
	const snapshot = snapshots.get(obsidian);
	if (!snapshot) return;
	await restoreCorePlugins(obsidian, snapshot);
	await obsidian.dev.evalJsonAsync(`(async () => {
		await app.plugins.disablePluginAndSave(${jsLiteral(PLUGIN_ID)});
		app.plugins.requestSaveConfig.cancel();
		await app.plugins.saveConfig();
		app.plugins.requestSaveConfig.cancel();
		await app.vault.adapter.promise;
		return true;
	})()`);
	await collectRuntimeErrors(obsidian);
	await obsidian.dev.evalJson("window.__podnotesJourneyCacheReload = true");
	await obsidian.exec("reload");
	await obsidian.waitFor(
		() =>
			obsidian.dev
				.evalJson<boolean>(
					"!window.__podnotesJourneyCacheReload && app.workspace.layoutReady && !app.plugins.plugins.podnotes",
				)
				.catch(() => false),
		{ timeoutMs: 30_000, intervalMs: 200, message: "the disabled plugin's renderer to reload" },
	);
	await obsidian.dev.evalJson(
		`app.saveLocalStorage(${jsLiteral(FEED_CACHE_KEY)}, ${jsLiteral(snapshot.cache)}), true`,
	);
}

export async function restoreJourneyWorkspace(obsidian: ObsidianClient): Promise<void> {
	const snapshot = snapshots.get(obsidian);
	if (!snapshot) return;
	const failures: unknown[] = [];
	try {
		const mobile = await obsidian.dev.evalJson<boolean>("app.isMobile");
		if (mobile !== snapshot.mobile) {
			await setMobileEmulation(obsidian, snapshot.mobile);
			await restoreCorePlugins(obsidian, snapshot);
		}
		await obsidian.dev.evalJsonAsync(`(async () => {
			await app.workspace.changeLayout(${jsLiteral(snapshot.layout)});
			app.workspace.recentFileTracker.load(${jsLiteral(snapshot.recentFiles)});
			electronWindow.setSize(${snapshot.size[0]}, ${snapshot.size[1]});
			app.workspace.requestSaveLayout.cancel();
			await app.workspace.saveLayout();
			app.workspace.requestSaveLayout.cancel();
			app.internalPlugins.requestSaveConfig.cancel();
			await app.internalPlugins.saveConfig();
			app.internalPlugins.requestSaveConfig.cancel();
			await app.vault.adapter.promise;
			return true;
		})()`);
		const leaked = await obsidian.dev.evalJson<Array<{ id: number; url: string }>>(`(() => {
			const remote = require("@electron/remote");
			const current = remote.getCurrentWindow();
			const extra = remote.BrowserWindow.getAllWindows().filter(win => win.id !== current.id);
			const details = extra.map(win => ({ id: win.id, url: win.webContents.getURL() }));
			for (const win of extra) win.close();
			return details;
		})()`);
		if (leaked.length) {
			await obsidian.waitFor(
				async () => {
					await assertSingleWindow(obsidian);
					return true;
				},
				{
					timeoutMs: 10_000,
					message: `test-created windows to close: ${JSON.stringify(leaked)}`,
				},
			);
			throw new Error(
				`The test leaked Obsidian windows: ${JSON.stringify(leaked)}. They were closed.`,
			);
		}
	} catch (error) {
		failures.push(error);
	}
	const restored = await Promise.allSettled(
		snapshot.workspaceFiles.map(async (file) => {
			if (file.bytes === null) await fs.rm(file.path, { force: true });
			else await fs.writeFile(file.path, file.bytes);
		}),
	);
	snapshots.delete(obsidian);
	for (const result of restored) {
		if (result.status === "rejected") failures.push(result.reason);
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, "Workspace could not be restored.");
}

async function restoreCorePlugins(
	obsidian: ObsidianClient,
	snapshot: JourneySnapshot,
): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		const manager = app.internalPlugins;
		for (const [id, enabled] of Object.entries(${jsLiteral(snapshot.corePlugins)})) {
			const plugin = manager.getPluginById(id);
			if (plugin.enabled === enabled) continue;
			if (enabled) await plugin.enable(false);
			else plugin.disable(false);
		}
		manager.requestSaveConfig.cancel();
		manager.config = ${jsLiteral(snapshot.coreConfig)};
		await manager.saveConfig();
		manager.requestSaveConfig.cancel();
		await app.vault.adapter.promise;
		return true;
	})()`);
}

export function storedEpisode(
	server: FixtureServer,
	feed: FixtureFeed,
	episode: FixtureEpisode,
): StoredEpisode {
	return {
		title: episode.title,
		podcastName: feed.title,
		streamUrl: server.mediaUrl(feed, episode),
		url: "",
		feedUrl: server.feedUrl(feed),
		description: episode.description ?? "",
		content: "",
		artworkUrl: feed.artwork ? server.artworkUrl(feed) : "",
		episodeDate: episode.pubDate ? new Date(episode.pubDate).toISOString() : "",
		mediaType: "audio",
	};
}

export function episodeRef(feed: FixtureFeed, episode: FixtureEpisode): EpisodeRef {
	return { podcast: feed.title, title: episode.title };
}

export async function seedLibrary(
	{ obsidian, plugin, sandbox }: JourneyContext,
	server: FixtureServer | null,
	seed: LibrarySeed = {},
): Promise<void> {
	await clearFeedCache(obsidian);
	await obsidian.dev.evalJsonAsync(`(async () => {
		await app.workspace.detachLeavesOfType(${jsLiteral(VIEW_TYPE)});
		return true;
	})()`);

	await plugin.updateDataAndReload<Json>((data) => {
		for (const key of Object.keys(data)) delete data[key];
		Object.assign(data, structuredClone(e2eConfig.defaultData));
		data.note.path = sandbox.path("PodNotes/{{podcast}}/{{title}}.md");
		data.feedNote.path = sandbox.path("PodNotes/Podcasts/{{podcast}}.md");
		data.download.path = sandbox.path("Downloads/{{podcast}}/{{title}}");
		data.transcript.path = sandbox.path("Transcripts/{{podcast}}/{{title}}.md");
		data.savedFeeds = Object.fromEntries(
			(seed.subscriptions ?? []).map((feed) => {
				if (!server) throw new Error("Subscriptions need a fixture server.");
				return [
					feed.title,
					{
						title: feed.title,
						url: server.feedUrl(feed),
						artworkUrl: feed.artwork ? server.artworkUrl(feed) : "",
					},
				];
			}),
		);
		if (seed.current) data.currentEpisode = seed.current;
		data.queue.episodes = seed.queue ?? [];
		data.playlists = Object.fromEntries(
			(seed.playlists ?? []).map((playlist) => [
				playlist.name,
				{
					icon: "list-music",
					name: playlist.name,
					episodes: playlist.episodes,
					shouldEpisodeRemoveAfterPlay: playlist.removeAfterPlay,
					shouldRepeat: false,
				},
			]),
		);
		data.playedEpisodes = Object.fromEntries(
			(seed.progress ?? []).map(({ episode, seconds, duration, finished }) => [
				`${episode.podcastName}::${episode.title}`,
				{
					title: episode.title,
					podcastName: episode.podcastName,
					time: seconds,
					duration,
					finished,
				},
			]),
		);
		if (seed.openAISecretId) data.openAISecretId = seed.openAISecretId;
		if (seed.transcriptTemplate) data.transcript.template = seed.transcriptTemplate;
	}, RELOAD_OPTIONS);
	await dismissNotices(obsidian);
}

export async function feedCacheText(obsidian: ObsidianClient): Promise<string> {
	const cached = await obsidian.dev.evalJson<string | null>(
		`app.loadLocalStorage(${jsLiteral(FEED_CACHE_KEY)})`,
	);
	return cached ?? "";
}

export async function clearFeedCache(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson(`app.saveLocalStorage(${jsLiteral(FEED_CACHE_KEY)}, null), true`);
}

export async function feedCacheHolds(
	obsidian: ObsidianClient,
	episodeTitle: string,
): Promise<boolean> {
	return (await feedCacheText(obsidian)).includes(JSON.stringify(episodeTitle));
}

export async function feedCachedAt(obsidian: ObsidianClient, feedUrl: string): Promise<number> {
	return await obsidian.dev.evalJson<number>(
		`JSON.parse(app.loadLocalStorage(${jsLiteral(FEED_CACHE_KEY)}) ?? "{}")[${jsLiteral(feedUrl)}]?.updatedAt ?? 0`,
	);
}

/** Backdate every feed cache entry, as if it were saved `ms` milliseconds earlier. */
export async function ageFeedCache(obsidian: ObsidianClient, ms: number): Promise<void> {
	await obsidian.dev.evalJson(`(() => {
		const cache = JSON.parse(app.loadLocalStorage(${jsLiteral(FEED_CACHE_KEY)}));
		for (const entry of Object.values(cache)) entry.updatedAt -= ${ms};
		app.saveLocalStorage(${jsLiteral(FEED_CACHE_KEY)}, JSON.stringify(cache));
		return true;
	})()`);
}

function decodeLibrary(data: Json): SavedLibrary {
	if (data.schemaVersion !== 2) {
		throw new Error(
			`data.json schema ${String(data.schemaVersion)} is not the v2 these journeys read.`,
		);
	}
	const titles = (episodes: Json[] | undefined) =>
		(episodes ?? []).map((episode) => String(episode.title));
	const played = Object.values<Json>(data.playedEpisodes ?? {});
	return {
		subscriptions: Object.values<Json>(data.savedFeeds ?? {}).map((feed) => ({
			title: String(feed.title),
			url: String(feed.url),
		})),
		currentEpisode: data.currentEpisode
			? {
					podcast: String(data.currentEpisode.podcastName),
					title: String(data.currentEpisode.title),
				}
			: null,
		queue: titles(data.queue?.episodes),
		playlists: Object.fromEntries(
			Object.values<Json>(data.playlists ?? {}).map((playlist) => [
				String(playlist.name),
				titles(playlist.episodes),
			]),
		),
		localFiles: (data.localFiles?.episodes ?? []).map((episode: Json) => ({
			title: String(episode.title),
			filePath: String(episode.filePath),
		})),
		downloads: Object.entries<Json[]>(data.downloadedEpisodes ?? {}).flatMap(
			([podcast, episodes]) =>
				episodes.map((episode) => ({
					podcast,
					title: String(episode.title),
					filePath: String(episode.filePath),
				})),
		),
		skipBackwardSeconds: Number(data.skipBackwardLength),
		progress: ({ podcast, title }) => {
			const record = played.find(
				(entry) => entry.podcastName === podcast && entry.title === title,
			);
			return record
				? {
						seconds: Number(record.time),
						duration: Number(record.duration),
						finished: record.finished === true,
					}
				: undefined;
		},
	};
}

export async function readLibrary(plugin: PluginHandle): Promise<SavedLibrary> {
	return decodeLibrary(await plugin.data<Json>().read());
}

export async function waitForLibrary(
	plugin: PluginHandle,
	predicate: (library: SavedLibrary) => boolean,
	message: string,
	timeoutMs = 15_000,
): Promise<SavedLibrary> {
	let last: SavedLibrary | undefined;
	try {
		await plugin.waitForData<Json>((data) => predicate((last = decodeLibrary(data))), {
			timeoutMs,
			intervalMs: 200,
		});
	} catch (error) {
		throw new Error(`${message} (data.json never matched): ${String(error)}`);
	}
	return last as SavedLibrary;
}

export async function observePlayback(obsidian: ObsidianClient): Promise<PlaybackObservation> {
	return await obsidian.dev.evalJson<PlaybackObservation>(`(() => {
		const api = app.plugins.plugins.${PLUGIN_ID}.api;
		const media = document.querySelector("audio.podnotes-media, video.podnotes-media");
		const episode = api.podcast;
		return {
			episode: episode ? { podcast: episode.podcastName, title: episode.title } : null,
			playing: api.isPlaying,
			seconds: api.currentTime,
			duration: Number.isFinite(api.length) ? api.length : null,
			media: media ? { src: media.currentSrc, paused: media.paused, seconds: media.currentTime } : null,
		};
	})()`);
}

export async function waitForPlayback(
	obsidian: ObsidianClient,
	predicate: (playback: PlaybackObservation) => boolean,
	message: string,
	timeoutMs = 15_000,
): Promise<PlaybackObservation> {
	let last: PlaybackObservation | undefined;
	try {
		return await obsidian.waitFor(
			async () => {
				last = await observePlayback(obsidian);
				return predicate(last) ? last : false;
			},
			{ timeoutMs, intervalMs: 100 },
		);
	} catch (error) {
		const cause = (error as { causeError?: unknown }).causeError;
		throw new Error(
			`${message}; last playback ${JSON.stringify(last)}: ${String(error)}${cause ? ` (last read failed: ${String(cause)})` : ""}`,
		);
	}
}

export async function playbackOver(
	obsidian: ObsidianClient,
	gapMs: number,
): Promise<[PlaybackObservation, PlaybackObservation]> {
	const first = await observePlayback(obsidian);
	if (first.playing) {
		await obsidian.sleep(gapMs);
		return [first, await observePlayback(obsidian)];
	}
	const until = Date.now() + gapMs;
	const second = await obsidian.waitFor(
		async () => {
			const current = await observePlayback(obsidian);
			if (
				current.playing ||
				current.seconds !== first.seconds ||
				current.media?.seconds !== first.media?.seconds
			)
				return current;
			return Date.now() >= until ? current : false;
		},
		{ timeoutMs: gapMs + 15_000, intervalMs: 100, message: "playback observation" },
	);
	if (
		second.playing ||
		second.seconds !== first.seconds ||
		second.media?.seconds !== first.media?.seconds
	)
		throw new Error(`Paused playback changed during observation: ${JSON.stringify(second)}`);
	return [first, second];
}

export async function readVaultBytes(obsidian: ObsidianClient, filePath: string): Promise<Buffer> {
	return await fs.readFile(path.join(await obsidian.vaultPath(), filePath));
}

export async function readVaultText(obsidian: ObsidianClient, filePath: string): Promise<string> {
	return (await readVaultBytes(obsidian, filePath)).toString("utf8");
}

export async function writeVaultFile(
	obsidian: ObsidianClient,
	filePath: string,
	contents: Buffer | string,
): Promise<void> {
	const absolute = path.join(await obsidian.vaultPath(), filePath);
	await fs.mkdir(path.dirname(absolute), { recursive: true });
	await fs.writeFile(absolute, contents);
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`Boolean(app.vault.getAbstractFileByPath(${jsLiteral(filePath)}))`,
			),
		{ timeoutMs: 10_000, intervalMs: 100, message: `${filePath} indexed by Obsidian` },
	);
}

export async function playerLeafCount(obsidian: ObsidianClient): Promise<number> {
	return await obsidian.dev.evalJson<number>(
		`app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)}).length`,
	);
}
