import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
	createLocalEpisode,
	createPodNotesE2EHarness,
	evalJsonAsync,
	getPlaybackState,
	invokePodNotesUri,
	openPodNotesView,
	type PodNotesData,
	seedAudio,
	waitForPlaybackState,
} from "./harness";
import { closePopoutAndReload, moveViewToPopout } from "./journey/actions";
import {
	jsLiteral,
	PLUGIN_ID,
	RELOAD_OPTIONS,
	VIEW_TYPE,
	WAIT_OPTS,
	waitForPodNotesReady,
} from "./runtime";

const getContext = createPodNotesE2EHarness("player-popout-save");
const EPISODE_TITLE = "E2E Popout Episode";
const PROGRESS_KEY = `local file::${EPISODE_TITLE}`;

type Obsidian = Parameters<typeof evalJsonAsync>[0];
type Order = "opened in a popout" | "moved to a popout while playing" | "in the main window";

async function play(order: Order): Promise<void> {
	const { obsidian, plugin, sandbox } = getContext();
	const audioPath = await seedAudio(obsidian, sandbox);
	const episode = createLocalEpisode(EPISODE_TITLE, audioPath);
	await plugin.updateDataAndReload<PodNotesData>((data) => {
		data.currentEpisode = undefined;
		data.downloadedEpisodes = {
			[episode.podcastName]: [{ ...episode, filePath: audioPath, size: 1 }],
		};
		data.playedEpisodes = {};
	}, RELOAD_OPTIONS);
	await waitForPodNotesReady(obsidian);
	await openPodNotesView(obsidian);
	if (order === "opened in a popout") await moveViewToPopout(obsidian);
	await invokePodNotesUri(obsidian, episode, 5);
	await waitForPlaybackState(
		obsidian,
		(state) => state.title === episode.title && state.isPlaying && (state.currentTime ?? 0) > 6,
	);
	if (order === "moved to a popout while playing") await moveViewToPopout(obsidian);
}

async function closePopout(obsidian: Obsidian): Promise<void> {
	expect(
		await evalJsonAsync<boolean>(
			obsidian,
			`(async () => {
				const leaf = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
				leaf.getContainer().win.close();
				for (let i = 0; i < 50 && app.workspace.floatingSplit.children.length > 0; i++) {
					await new Promise((resolve) => setTimeout(resolve, 100));
				}
				return app.workspace.floatingSplit.children.length === 0;
			})()`,
		),
	).toBe(true);
}

async function savedTime(dataPath: string): Promise<number | null> {
	const data = JSON.parse(await readFile(dataPath, "utf8")) as PodNotesData;
	return data.playedEpisodes?.[PROGRESS_KEY]?.time ?? null;
}

async function reloadObsidian(obsidian: Obsidian): Promise<void> {
	await obsidian.dev.evalJson("(() => { window.__podnotesBeforeReload = true; return true; })()");
	await obsidian.app.reload();
	await obsidian.waitFor(
		async () => {
			try {
				return await obsidian.dev.evalJson<boolean>(
					`!window.__podnotesBeforeReload && Boolean(app.plugins.plugins.${PLUGIN_ID}?.api)`,
				);
			} catch {
				return false;
			}
		},
		{ ...WAIT_OPTS, message: "Obsidian did not finish reloading." },
	);
	await waitForPodNotesReady(obsidian);
}

// The audio lives in the main window, so a popout holding the player is only a view of it.
for (const order of ["opened in a popout", "moved to a popout while playing"] as const) {
	test(`closing a popout with a player ${order} keeps the audio playing and data.json intact`, async () => {
		const { obsidian, plugin } = getContext();
		await play(order);
		try {
			await closePopout(obsidian);
			const before = await getPlaybackState(obsidian);
			await obsidian.sleep(1500);
			const after = await getPlaybackState(obsidian);

			expect(after).toMatchObject({ title: EPISODE_TITLE, isPlaying: true });
			expect((after.currentTime ?? 0) - (before.currentTime ?? 0)).toBeGreaterThan(1);
			expect(
				await obsidian.dev.evalJson<boolean>(
					`document.querySelector("audio.podnotes-media")?.paused === false`,
				),
			).toBe(true);
			const data = JSON.parse(
				await readFile(await plugin.dataPath(), "utf8"),
			) as PodNotesData;
			expect(data.currentEpisode?.title).toBe(EPISODE_TITLE);
		} finally {
			await closePopoutAndReload(obsidian);
		}
	});
}

test("keeps data.json intact through a reload right after a popout player closes (#370)", async () => {
	const { obsidian, plugin } = getContext();
	await play("opened in a popout");
	const dataPath = await plugin.dataPath();
	try {
		await obsidian.waitFor(async () => ((await savedTime(dataPath)) ?? 0) >= 5, {
			timeoutMs: 20_000,
			intervalMs: 200,
			message: "A playback checkpoint reached data.json.",
		});
		const saved = (await savedTime(dataPath)) as number;
		await closePopout(obsidian);
		await reloadObsidian(obsidian);

		const data = JSON.parse(await readFile(dataPath, "utf8")) as PodNotesData;
		expect(data.currentEpisode?.title).toBe(EPISODE_TITLE);
		expect(data.playedEpisodes?.[PROGRESS_KEY]?.time).toBeGreaterThanOrEqual(saved);
		const restored = await getPlaybackState(obsidian);
		expect(restored).toMatchObject({ title: EPISODE_TITLE, isPlaying: false });
		expect(restored.currentTime).toBeGreaterThanOrEqual(saved);
	} finally {
		await closePopoutAndReload(obsidian);
	}
});

// Hiding the app is the last reliable moment before the OS may suspend or kill it.
test("hiding the main window saves the playing position at once", async () => {
	const { obsidian } = getContext();
	await play("in the main window");
	try {
		const result = await evalJsonAsync<{
			saved: number | null;
			hidden: boolean;
			afterSaveMs: number;
		}>(
			obsidian,
			`(async () => {
				const fs = require("fs");
				const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
				const podnotes = app.plugins.plugins.${PLUGIN_ID};
				const file = app.vault.adapter.getFullPath(podnotes.manifest.dir + "/data.json");
				const saved = () =>
					JSON.parse(fs.readFileSync(file, "utf8")).playedEpisodes[${jsLiteral(PROGRESS_KEY)}]?.time ?? null;
				const mtime = fs.statSync(file).mtimeMs;
				const waitStart = Date.now();
				while (fs.statSync(file).mtimeMs === mtime) {
					if (Date.now() - waitStart > 12000) throw new Error("No save landed within 12 s.");
					await sleep(25);
				}
				const savedAt = Date.now();
				podnotes.api.currentTime = 42;
				await sleep(150);
				require("@electron/remote").getCurrentWindow().hide();
				await sleep(100);
				const hidden = document.visibilityState === "hidden";
				await sleep(400);
				return { saved: saved(), hidden, afterSaveMs: Date.now() - savedAt };
			})()`,
		);

		// The next checkpoint comes at least 10 s after the save awaited, so only the hide saved 42.
		expect(result.hidden).toBe(true);
		expect(result.afterSaveMs).toBeLessThan(5000);
		expect(result.saved).toBeGreaterThanOrEqual(42);
	} finally {
		await closePopoutAndReload(obsidian);
	}
});
