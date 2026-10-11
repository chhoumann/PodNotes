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

// Hiding the window is the last reliable moment before the OS may suspend or
// kill the app, so the player saves its position then. In a popout that is the
// popout's own document, not the main window's.
async function moveViewToPopout(obsidian: Parameters<typeof evalJsonAsync>[0]): Promise<void> {
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

for (const order of ["opened in a popout", "moved to a popout while playing"] as const) {
	test(`saves the position when the window of a player ${order} is hidden`, async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const audioPath = await seedAudio(obsidian, sandbox);
		const episode = createLocalEpisode("E2E Popout Episode", audioPath);
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
			(state) =>
				state.title === episode.title && state.isPlaying && (state.currentTime ?? 0) > 6,
		);
		if (order === "moved to a popout while playing") await moveViewToPopout(obsidian);

		try {
			// The player also saves every 5 s while playing. Seek and hide right after one
			// of those saves, and read the file before the next one is due.
			const result = await evalJsonAsync<{ hidden: boolean; saved: number | null }>(
				obsidian,
				`(async () => {
					const fs = require("fs");
					const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
					const podnotes = app.plugins.plugins.${PLUGIN_ID};
					const file = app.vault.adapter.getFullPath(podnotes.manifest.dir + "/data.json");
					const saved = () =>
						JSON.parse(fs.readFileSync(file, "utf8")).playedEpisodes[
							${JSON.stringify(`local file::${episode.title}`)}
						]?.time ?? null;
					const leaf = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0];
					const doc = leaf.view.containerEl.ownerDocument;
					const mtime = fs.statSync(file).mtimeMs;
					const waitStart = Date.now();
					while (fs.statSync(file).mtimeMs === mtime && Date.now() - waitStart < 8000) await sleep(25);
					const savedAt = Date.now();
					doc.querySelector(".podcast-view audio").currentTime = 42;
					await sleep(150);
					leaf.getContainer().win.electronWindow.hide();
					await sleep(100);
					const hidden = doc.visibilityState === "hidden";
					while (Date.now() - savedAt < 3500) await sleep(100);
					return { hidden, saved: saved() };
				})()`,
			);

			expect(result.hidden).toBe(true);
			expect(result.saved).toBeGreaterThanOrEqual(42);
		} finally {
			// Close the popout here, visible, so no hidden window outlives the test.
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
					// Otherwise the saved layout still has the popout, and the next reload reopens it.
					app.workspace.requestSaveLayout.cancel();
					await app.workspace.saveLayout();
					return true;
				})()`,
			);
			// Hiding and closing a popout leaves Obsidian's layout observers looping in the
			// main window for a while; a fresh window keeps later tests clean.
			await obsidian.dev.evalJson(
				"(() => { window.__podnotesBeforeReload = true; return true; })()",
			);
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
	});
}
