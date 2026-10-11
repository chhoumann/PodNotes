import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import {
	createLocalEpisode,
	createPodNotesE2EHarness,
	evalJsonAsync,
	invokePodNotesUri,
	openPodNotesView,
	PLUGIN_ID,
	type PodNotesData,
	RELOAD_OPTIONS,
	seedAudio,
	VIEW_TYPE,
	WAIT_OPTS,
	waitForPlaybackState,
	waitForPodNotesReady,
} from "./harness";

const getContext = createPodNotesE2EHarness("player-popout-save");
const EPISODE_TITLE = "E2E Popout Episode";
const PROGRESS_KEY = `local file::${EPISODE_TITLE}`;

type Obsidian = Parameters<typeof evalJsonAsync>[0];

async function moveViewToPopout(obsidian: Obsidian): Promise<void> {
	expect(
		await evalJsonAsync<boolean>(
			obsidian,
			`(async () => {
				const leaf = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0];
				app.workspace.moveLeafToPopout(leaf);
				for (let i = 0; i < 50; i++) {
					await new Promise((resolve) => setTimeout(resolve, 100));
					const moved = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0];
					if (moved?.view.containerEl.ownerDocument !== document) return true;
				}
				return false;
			})()`,
		),
	).toBe(true);
}

async function playInPopout(
	order: "opened in a popout" | "moved to a popout while playing",
): Promise<void> {
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

/**
 * Waits for a save to land, seeks to 42 s, runs `action` (renderer code with `leaf`
 * in scope), waits `waitMs`, and reads the saved position. The next periodic save
 * comes at least 10 s after the one awaited, so until then only `action` can save 42.
 */
async function seekAndThen(
	obsidian: Obsidian,
	action: string,
	waitMs: number,
): Promise<{ saved: number | null; hidden: boolean; afterSaveMs: number }> {
	return evalJsonAsync(
		obsidian,
		`(async () => {
			const fs = require("fs");
			const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
			const podnotes = app.plugins.plugins.${PLUGIN_ID};
			const file = app.vault.adapter.getFullPath(podnotes.manifest.dir + "/data.json");
			const saved = () =>
				JSON.parse(fs.readFileSync(file, "utf8")).playedEpisodes[${JSON.stringify(PROGRESS_KEY)}]?.time ?? null;
			const leaf = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0];
			const doc = leaf.view.containerEl.ownerDocument;
			const mtime = fs.statSync(file).mtimeMs;
			const waitStart = Date.now();
			while (fs.statSync(file).mtimeMs === mtime) {
				if (Date.now() - waitStart > 12000) throw new Error("No save landed within 12 s.");
				await sleep(25);
			}
			const savedAt = Date.now();
			doc.querySelector(".podcast-view audio").currentTime = 42;
			await sleep(150);
			${action};
			await sleep(100);
			const hidden = doc.visibilityState === "hidden";
			await sleep(${waitMs});
			return { saved: saved(), hidden, afterSaveMs: Date.now() - savedAt };
		})()`,
	);
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

// Closes a popout left open, saves the layout so no reload reopens it, and reloads:
// hiding and closing a popout leaves Obsidian's layout observers looping in the main
// window for a while, and a fresh window keeps later tests clean.
async function closePopoutAndReload(obsidian: Obsidian): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`(async () => {
			const leaf = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0];
			leaf?.getContainer().win.electronWindow?.show();
			leaf?.detach();
			const windows = () => require("@electron/remote").BrowserWindow.getAllWindows().length;
			for (let i = 0; i < 50 && (app.workspace.floatingSplit.children.length > 0 || windows() > 1); i++) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			app.workspace.requestSaveLayout.cancel();
			await app.workspace.saveLayout();
			return true;
		})()`,
	);
	await reloadObsidian(obsidian);
}

// Hiding the window is the last reliable moment before the OS may suspend or kill
// the app, so the player saves its position then. In a popout that is the popout's
// own document, not the main window's.
for (const order of ["opened in a popout", "moved to a popout while playing"] as const) {
	test(`saves the position when the window of a player ${order} is hidden`, async () => {
		const { obsidian } = getContext();
		await playInPopout(order);
		try {
			const result = await seekAndThen(
				obsidian,
				"leaf.getContainer().win.electronWindow.hide()",
				400,
			);

			expect(result.hidden).toBe(true);
			expect(result.afterSaveMs).toBeLessThan(5000);
			expect(result.saved).toBeGreaterThanOrEqual(42);
		} finally {
			await closePopoutAndReload(obsidian);
		}
	});
}

test("saves the position when a visible popout player is closed", async () => {
	const { obsidian } = getContext();
	await playInPopout("opened in a popout");
	try {
		const result = await seekAndThen(obsidian, "leaf.getContainer().win.close()", 2500);

		expect(result.afterSaveMs).toBeLessThan(5000);
		expect(result.saved).toBeGreaterThanOrEqual(42);
	} finally {
		await closePopoutAndReload(obsidian);
	}
});

test("keeps the position of a closed popout player through an immediate reload", async () => {
	const { obsidian, plugin } = getContext();
	await playInPopout("opened in a popout");
	const dataPath = await plugin.dataPath();
	try {
		await seekAndThen(obsidian, "leaf.getContainer().win.close()", 0);
		await reloadObsidian(obsidian);

		const data = JSON.parse(await readFile(dataPath, "utf8")) as PodNotesData;
		expect(data.playedEpisodes?.[PROGRESS_KEY]?.time).toBeGreaterThanOrEqual(42);
	} finally {
		await closePopoutAndReload(obsidian);
	}
});
