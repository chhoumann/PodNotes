import type { ObsidianClient } from "obsidian-e2e";
import { describe, expect, test } from "vitest";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";
import {
	createPodNotesE2EHarness,
	evalJsonAsync,
	RELOAD_OPTIONS,
	VIEW_TYPE,
	WAIT_OPTS,
	waitForPodNotesReady,
	writeSilentWav,
} from "./harness";

type PodNotesData = Partial<IPodNotesSettings>;

const getContext = createPodNotesE2EHarness("local-files-runtime");

describe("local files runtime", () => {
	test("removing a local file from Local Files keeps the user's file in the vault", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const title = `E2E Own Recording ${Date.now()}`;
		const fileName = `${title}.wav`;
		const audioPath = sandbox.path(fileName);
		const inDownloads = (data: PodNotesData) =>
			data.downloadedEpisodes?.["local file"]?.some(
				(entry) => entry.filePath === audioPath,
			) ?? false;
		const inLocalFiles = (data: PodNotesData) =>
			data.localFiles?.episodes.some((episode) => episode.title === title) ?? false;
		const trashedFixture = async () =>
			(await listTrash(obsidian)).filter((path) => path.includes(title));

		await plugin.updateDataAndReload<PodNotesData>((data) => {
			data.downloadedEpisodes = {};
			data.playedEpisodes = {};
		}, RELOAD_OPTIONS);
		await waitForPodNotesReady(obsidian);
		await writeSilentWav(obsidian, audioPath, 60);
		await sandbox.waitForExists(fileName, WAIT_OPTS);
		const fileExplorerWasEnabled = await setFileExplorerEnabled(obsidian, true);

		try {
			await openFileMenu(obsidian, audioPath);
			await clickMenuItem(obsidian, "Play with PodNotes");
			await plugin.waitForData<PodNotesData>(
				(data) => inDownloads(data) && inLocalFiles(data),
				WAIT_OPTS,
			);
			// Until #355 keeps the player's <audio> mounted, leaving the player before
			// play() settles rejects it, and Svelte's bind:paused rethrows the rejection.
			await obsidian.waitFor(
				() =>
					obsidian.dev.evalJson<boolean>(
						`(app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view.containerEl.querySelector("audio")?.currentTime ?? 0) > 0`,
					),
				{ ...WAIT_OPTS, message: `${title} did not start playing.` },
			);

			await clickInPodNotesView(obsidian, 'button[aria-label="Podcast grid"]');
			await clickInPodNotesView(obsidian, 'button.playlist-card[aria-label="Local Files"]');
			await clickInPodNotesView(obsidian, `[aria-label="More options for ${title}"]`);
			await clickMenuItem(obsidian, "Remove file");
			await plugin.waitForData<PodNotesData>(
				(data) => !inDownloads(data) && !inLocalFiles(data),
				WAIT_OPTS,
			);

			const after = await evalJsonAsync<{ listed: boolean; original: boolean }>(
				obsidian,
				`(async () => {
					const view = app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view;
					return {
						listed: Array.from(view?.containerEl.querySelectorAll(".episode-item-title") ?? [])
							.some((candidate) => candidate.textContent?.trim() === ${JSON.stringify(title)}),
						original: await app.vault.adapter.exists(${JSON.stringify(audioPath)}),
					};
				})()`,
			);
			expect({ ...after, trashed: await trashedFixture() }).toEqual({
				listed: false,
				original: true,
				trashed: [],
			});
			expect(await obsidian.dev.runtimeErrors()).toEqual([]);
		} finally {
			await setFileExplorerEnabled(obsidian, fileExplorerWasEnabled);
			await evalJsonAsync<boolean>(
				obsidian,
				`(async () => {
					for (const path of ${JSON.stringify(await trashedFixture())}) {
						await app.vault.adapter.remove(path);
					}
					return true;
				})()`,
			);
		}
	}, 60_000);
});

async function listTrash(obsidian: ObsidianClient): Promise<string[]> {
	return evalJsonAsync<string[]>(
		obsidian,
		`(async () => {
			const { adapter } = app.vault;
			return (await adapter.exists(".trash")) ? (await adapter.list(".trash")).files : [];
		})()`,
	);
}

async function setFileExplorerEnabled(
	obsidian: ObsidianClient,
	enabled: boolean,
): Promise<boolean> {
	return evalJsonAsync<boolean>(
		obsidian,
		`(async () => {
			const fileExplorer = app.internalPlugins.getPluginById("file-explorer");
			const wasEnabled = fileExplorer.enabled;
			if (${enabled} && !wasEnabled) await fileExplorer.enable(true);
			if (${!enabled} && wasEnabled) fileExplorer.disable(true);
			return wasEnabled;
		})()`,
	);
}

async function openFileMenu(obsidian: ObsidianClient, path: string): Promise<void> {
	const selector = `.nav-file-title[data-path=${JSON.stringify(path)}]`;
	await evalJsonAsync<boolean>(
		obsidian,
		`(async () => {
			const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
			if (!leaf) throw new Error("File explorer is not open.");
			await app.workspace.revealLeaf(leaf);
			leaf.view.revealInFolder(app.vault.getAbstractFileByPath(${JSON.stringify(path)}));
			return true;
		})()`,
	);
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`Boolean(document.querySelector(${JSON.stringify(selector)}))`,
			),
		{ ...WAIT_OPTS, message: `${path} is not shown in the file explorer.` },
	);
	await evalJsonAsync<boolean>(
		obsidian,
		`(() => {
			const target = document.querySelector(${JSON.stringify(selector)});
			const { left, top } = target.getBoundingClientRect();
			target.dispatchEvent(new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				button: 2,
				clientX: left + 8,
				clientY: top + 8,
			}));
			return true;
		})()`,
	);
}

async function clickMenuItem(obsidian: ObsidianClient, label: string): Promise<string[]> {
	const items = `Array.from(document.querySelectorAll(".menu .menu-item"))`;
	const titleOf = `(item) => item.querySelector(".menu-item-title")?.textContent?.trim()`;
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`${items}.map(${titleOf}).includes(${JSON.stringify(label)})`,
			),
		{ ...WAIT_OPTS, message: `Menu item "${label}" did not appear.` },
	);
	return evalJsonAsync<string[]>(
		obsidian,
		`(() => {
			const items = ${items};
			const offered = items.map(${titleOf});
			items[offered.indexOf(${JSON.stringify(label)})].click();
			return offered;
		})()`,
	);
}

async function clickInPodNotesView(obsidian: ObsidianClient, selector: string): Promise<void> {
	const findTarget = `app.workspace.getLeavesOfType(${JSON.stringify(VIEW_TYPE)})[0]?.view.containerEl.querySelector(${JSON.stringify(selector)})`;
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`(() => { const target = ${findTarget}; return target instanceof HTMLElement && target.getBoundingClientRect().width > 0; })()`,
			),
		{ ...WAIT_OPTS, message: `${selector} is not visible in the PodNotes view.` },
	);
	await evalJsonAsync<boolean>(obsidian, `(() => { ${findTarget}.click(); return true; })()`);
}
