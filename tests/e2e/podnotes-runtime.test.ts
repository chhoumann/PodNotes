import type { PluginHandle, SandboxApi } from "obsidian-e2e";
import { describe, expect, test } from "vitest";
import type DownloadedEpisode from "../../src/types/DownloadedEpisode";
import type { Episode } from "../../src/types/Episode";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";
import type { LocalEpisode } from "../../src/types/LocalEpisode";
import encodePodnotesURI from "../../src/utility/encodePodnotesURI";
import {
	createPodNotesE2EHarness,
	evalJsonAsync,
	openPodNotesView,
	PLUGIN_ID,
	RELOAD_OPTIONS,
	VIEW_TYPE,
	WAIT_OPTS,
	waitForPodNotesReady,
} from "./harness";

type PodNotesData = Partial<IPodNotesSettings>;

type PlaybackState = {
	currentTime: number | null;
	hasPlayer: boolean;
	isPlaying: boolean;
	title: string | null;
};

const getContext = createPodNotesE2EHarness("podnotes-runtime");

describe("PodNotes runtime", () => {
	test("registers commands, protocol handling, and the player view", async () => {
		const { obsidian } = getContext();

		await openPodNotesView(obsidian);

		const state = await obsidian.dev.evalJson<{
			hasProtocolHandler: boolean;
			hasShowCommand: boolean;
			viewCount: number;
		}>(`
			(() => ({
				hasProtocolHandler: app.workspace.protocolHandlers?.has(${JSON.stringify(PLUGIN_ID)}) ?? false,
				hasShowCommand: Boolean(app.commands?.commands?.[${JSON.stringify(`${PLUGIN_ID}:podnotes-show-leaf`)}]),
				viewCount: app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)}).length,
			}))()
		`);

		expect(state).toMatchObject({
			hasProtocolHandler: true,
			hasShowCommand: true,
		});
		expect(state.viewCount).toBeGreaterThan(0);
		expect(await obsidian.dev.runtimeErrors()).toEqual([]);
	});

	test("opens timestamp URI links at requested progress even after an episode is played", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "finished-episode.mp3");
		const episode = createLocalEpisode("E2E Finished Episode", audioPath);

		await seedRuntimeData(plugin, sandbox, episode, {
			played: { duration: 3600, time: 3600 },
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);

		await invokePodNotesUri(obsidian, episode, 240);
		await dispatchLoadedMetadata(obsidian);

		const state = await waitForPlaybackState(
			obsidian,
			(value) =>
				value.hasPlayer &&
				value.title === episode.title &&
				value.isPlaying &&
				value.currentTime === 240,
		);

		expect(state).toMatchObject({
			currentTime: 240,
			hasPlayer: true,
			isPlaying: true,
			title: episode.title,
		});
	});

	test("preserves zero-second timestamp URI links at runtime", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "zero-second-episode.mp3");
		const episode = createLocalEpisode("E2E Zero Second Episode", audioPath);

		await seedRuntimeData(plugin, sandbox, episode, {
			played: { duration: 3600, time: 3600 },
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);

		await invokePodNotesUri(obsidian, episode, 0);
		await dispatchLoadedMetadata(obsidian);

		const state = await waitForPlaybackState(
			obsidian,
			(value) =>
				value.hasPlayer &&
				value.title === episode.title &&
				value.isPlaying &&
				value.currentTime === 0,
		);

		expect(state).toMatchObject({
			currentTime: 0,
			hasPlayer: true,
			isPlaying: true,
			title: episode.title,
		});
	});

	test("seeks immediately when the linked episode is already loaded", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "already-loaded-episode.mp3");
		const episode = createLocalEpisode("E2E Already Loaded Episode", audioPath);

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);
		await setPlayback(obsidian, { currentTime: 999, paused: true });

		await invokePodNotesUri(
			obsidian,
			{
				...episode,
				filePath: "https://invalid.invalid/podnotes-e2e.xml",
				streamUrl: "https://invalid.invalid/podnotes-e2e.xml",
				url: "https://invalid.invalid/podnotes-e2e.xml",
			},
			12,
		);
		await dispatchAudioPlay(obsidian);

		const state = await waitForPlaybackState(
			obsidian,
			(value) =>
				value.title === episode.title &&
				value.isPlaying &&
				value.currentTime === 12,
		);

		expect(state).toMatchObject({
			currentTime: 12,
			isPlaying: true,
			title: episode.title,
		});
		expect(await obsidian.dev.notices()).not.toContainEqual(
			expect.objectContaining({ message: "Episode not found" }),
		);
	});

	test("captures a linked timestamp into the active editor", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(sandbox, "capture-episode.mp3");
		const episode = createLocalEpisode("E2E Capture Episode", audioPath);
		const notePath = sandbox.path("capture-target.md");

		await seedRuntimeData(plugin, sandbox, episode, {
			currentEpisode: episode,
			timestampTemplate: "- {{linktime}}",
		});
		await waitForPodNotesReady(obsidian);
		await sandbox.write("capture-target.md", "", { waitForContent: true });
		await obsidian.open({ path: notePath });
		await obsidian.waitForActiveFile(notePath, WAIT_OPTS);
		await setPlayback(obsidian, { currentTime: 125, paused: false });

		await obsidian.command(`${PLUGIN_ID}:capture-timestamp`).run();

		const expectedLink = `- ${expectedTimestampLink("00:02:05", episode, 125)}`;
		const content = await sandbox.waitForContent(
			"capture-target.md",
			(value) => value.includes(expectedLink),
			WAIT_OPTS,
		);

		expect(content).toContain(expectedLink);
		expect(content).toContain("obsidian://podnotes");
		expect(content).toContain("episodeName=E2E%20Capture%20Episode");
		expect(content).toContain("time=125");
	});

	test("persists API volume changes and clamps out-of-range values", async () => {
		const { obsidian, plugin } = getContext();

		await plugin.updateDataAndReload<PodNotesData>((data) => {
			data.defaultVolume = 1;
		}, RELOAD_OPTIONS);
		await waitForPodNotesReady(obsidian);

		await setVolume(obsidian, 0.42);
		await plugin.waitForData<PodNotesData>(
			(data) => data.defaultVolume === 0.42,
			WAIT_OPTS,
		);

		await setVolume(obsidian, 1.5);
		const data = await plugin.waitForData<PodNotesData>(
			(value) => value.defaultVolume === 1,
			WAIT_OPTS,
		);
		const runtimeVolume = await getVolume(obsidian);

		expect(data.defaultVolume).toBe(1);
		expect(runtimeVolume).toBe(1);
	});
});

async function seedAudio(
	sandbox: SandboxApi,
	fileName: string,
): Promise<string> {
	await sandbox.write(fileName, "podnotes e2e audio placeholder", {
		waitForContent: true,
		waitOptions: WAIT_OPTS,
	});

	return sandbox.path(fileName);
}

function createLocalEpisode(title: string, audioPath: string): LocalEpisode {
	return {
		title,
		streamUrl: audioPath,
		url: audioPath,
		description: "",
		content: "",
		podcastName: "local file",
		filePath: audioPath,
	};
}

async function seedRuntimeData(
	plugin: PluginHandle,
	sandbox: SandboxApi,
	episode: LocalEpisode,
	options: {
		currentEpisode?: Episode;
		played?: { duration: number; time: number };
		timestampTemplate?: string;
	} = {},
): Promise<void> {
	const placeholderEpisode = createLocalEpisode(
		"E2E Placeholder Episode",
		sandbox.path("placeholder.mp3"),
	);
	const localEpisodes = [episode];

	if (!options.currentEpisode) {
		localEpisodes.push(placeholderEpisode);
	}

	await plugin.updateDataAndReload<PodNotesData>((data) => {
		data.currentEpisode = options.currentEpisode ?? placeholderEpisode;
		data.defaultVolume = 1;
		data.downloadedEpisodes = {
			[episode.podcastName]: [toDownloadedEpisode(episode)],
		};
		data.favorites = createPlaylist("Favorites", "lucide-star", []);
		data.localFiles = createPlaylist("Local Files", "folder", localEpisodes);
		data.playedEpisodes = options.played
			? {
					[episodeKey(episode)]: {
						title: episode.title,
						podcastName: episode.podcastName,
						time: options.played.time,
						duration: options.played.duration,
						finished: true,
					},
				}
			: {};
		data.playlists = {};
		data.queue = createPlaylist("Queue", "list-ordered", []);
		data.timestamp = {
			template: options.timestampTemplate ?? "- {{time}}",
			offset: 0,
		};
	}, RELOAD_OPTIONS);
}

function createPlaylist(
	name: string,
	icon: "folder" | "list-ordered" | "lucide-star",
	episodes: Episode[],
) {
	return {
		icon,
		name,
		episodes,
		shouldEpisodeRemoveAfterPlay: name === "Queue",
		shouldRepeat: false,
	};
}

function toDownloadedEpisode(episode: LocalEpisode): DownloadedEpisode {
	return {
		...episode,
		filePath: episode.filePath ?? episode.streamUrl,
		size: 1,
	};
}

function episodeKey(episode: Episode): string {
	return `${episode.podcastName}::${episode.title}`;
}

async function invokePodNotesUri(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	episode: LocalEpisode,
	time: number,
): Promise<void> {
	const result = await evalJsonAsync<{ error?: string; ok: boolean }>(
		obsidian,
		`
		(async () => {
			const handler = app.workspace.protocolHandlers.get(${JSON.stringify(PLUGIN_ID)});
			if (!handler) {
				return { ok: false, error: "PodNotes protocol handler is not registered." };
			}

			await handler({
				action: ${JSON.stringify(PLUGIN_ID)},
				url: ${JSON.stringify(episode.filePath ?? episode.streamUrl)},
				episodeName: ${JSON.stringify(episode.title)},
				time: ${JSON.stringify(String(time))},
			});

			return { ok: true };
		})()
	`,
	);

	if (!result.ok) {
		throw new Error(result.error ?? "PodNotes URI handler failed.");
	}
}

async function dispatchLoadedMetadata(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
}): Promise<void> {
	const result = await obsidian.dev.evalJson<{ error?: string; ok: boolean }>(`
		(() => {
			const audio = document.querySelector(".podcast-view audio");
			if (!audio) {
				return { ok: false, error: "No PodNotes audio element found." };
			}

			Object.defineProperty(audio, "duration", {
				configurable: true,
				value: 3600,
			});
			audio.dispatchEvent(new Event("loadedmetadata"));
			Object.defineProperty(audio, "paused", {
				configurable: true,
				value: false,
			});
			audio.dispatchEvent(new Event("play"));

			return { ok: true };
		})()
	`);

	if (!result.ok) {
		throw new Error(result.error ?? "Failed to dispatch loadedmetadata.");
	}
}

async function dispatchAudioPlay(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
}): Promise<void> {
	const result = await obsidian.dev.evalJson<{ error?: string; ok: boolean }>(`
		(() => {
			const audio = document.querySelector(".podcast-view audio");
			if (!audio) {
				return { ok: false, error: "No PodNotes audio element found." };
			}

			Object.defineProperty(audio, "paused", {
				configurable: true,
				value: false,
			});
			audio.dispatchEvent(new Event("play"));

			return { ok: true };
		})()
	`);

	if (!result.ok) {
		throw new Error(result.error ?? "Failed to dispatch audio play.");
	}
}

async function waitForPlaybackState(
	obsidian: {
		dev: { evalJson: <T>(code: string) => Promise<T> };
		sleep: (ms: number) => Promise<void>;
	},
	predicate: (state: PlaybackState) => boolean,
): Promise<PlaybackState> {
	const startedAt = Date.now();
	let lastState: PlaybackState | null = null;

	while (Date.now() - startedAt < WAIT_OPTS.timeoutMs) {
		lastState = await getPlaybackState(obsidian);
		if (predicate(lastState)) return lastState;
		await obsidian.sleep(WAIT_OPTS.intervalMs);
	}

	throw new Error(
		`Timed out waiting for playback state. Last state: ${JSON.stringify(lastState)}`,
	);
}

async function getPlaybackState(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
}): Promise<PlaybackState> {
	return await obsidian.dev.evalJson<PlaybackState>(`
		(() => {
			const plugin = app.plugins.plugins.${PLUGIN_ID};
			return {
				currentTime: plugin?.api?.currentTime ?? null,
				hasPlayer: Boolean(document.querySelector(".episode-player")),
				isPlaying: Boolean(plugin?.api?.isPlaying),
				title: plugin?.api?.podcast?.title ?? null,
			};
		})()
	`);
}

async function setPlayback(
	obsidian: { dev: { evalJson: <T>(code: string) => Promise<T> } },
	{ currentTime, paused }: { currentTime: number; paused: boolean },
): Promise<void> {
	await obsidian.dev.evalJson(`
		(() => {
			const api = app.plugins.plugins.${PLUGIN_ID}.api;
			api.currentTime = ${JSON.stringify(currentTime)};
			if (${JSON.stringify(paused)}) {
				api.stop();
			} else {
				api.start();
			}
			return true;
		})()
	`);
}

async function setVolume(
	obsidian: { dev: { evalJson: <T>(code: string) => Promise<T> } },
	value: number,
): Promise<void> {
	await obsidian.dev.evalJson(`
		(() => {
			app.plugins.plugins.${PLUGIN_ID}.api.volume = ${JSON.stringify(value)};
			return true;
		})()
	`);
}

async function getVolume(obsidian: {
	dev: { evalJson: <T>(code: string) => Promise<T> };
}): Promise<number> {
	return await obsidian.dev.evalJson<number>(`
		app.plugins.plugins.${PLUGIN_ID}.api.volume
	`);
}

function expectedTimestampLink(
	label: string,
	episode: LocalEpisode,
	time: number,
): string {
	// Use the production encoder so this helper can never drift from the real wire format.
	const uri = encodePodnotesURI(
		episode.title,
		episode.filePath ?? episode.streamUrl,
		time,
	);

	return `[${label}](${uri.href})`;
}
