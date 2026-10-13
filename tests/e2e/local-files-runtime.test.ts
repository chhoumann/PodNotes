import type { ObsidianClient } from "obsidian-e2e";
import { describe, expect, test } from "vitest";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";
import {
	createPodNotesE2EHarness,
	evalJsonAsync,
	openPodNotesView,
	writeSilentWav,
} from "./harness";

import { click, revealInFileExplorer, showList, ui } from "./journey/actions";
import { jsLiteral, RELOAD_OPTIONS, VIEW_TYPE, WAIT_OPTS, waitForPodNotesReady } from "./runtime";

type PodNotesData = Partial<IPodNotesSettings>;

const SILENT_WAV_SECOND_BYTES = 44 + 8_000;

const getContext = createPodNotesE2EHarness("local-files-runtime");

describe("local files runtime", () => {
	test.each(["disabled", "enabled and open", "enabled and closed"] as const)(
		"removing a local file from Local Files keeps the user's file in the vault (%s explorer)",
		async (explorer) => {
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
			if (explorer === "disabled")
				await obsidian.plugin("file-explorer").disable({ filter: "core" });
			else await obsidian.plugin("file-explorer").enable({ filter: "core" });
			if (explorer === "enabled and open")
				await obsidian.exec("command", { id: "file-explorer:open" });
			else
				await obsidian.dev.evalJsonAsync(
					'(async () => { await app.workspace.detachLeavesOfType("file-explorer"); return true; })()',
				);
			await obsidian.plugin("file-explorer").enable({ filter: "core" });

			try {
				await revealInFileExplorer(obsidian, audioPath);
				await click(obsidian, ui.fileExplorerItem(audioPath), { button: "right" });
				await clickMenuItem(obsidian, "Play with PodNotes");
				await plugin.waitForData<PodNotesData>(
					(data) => inDownloads(data) && inLocalFiles(data),
					WAIT_OPTS,
				);
				await showList(obsidian, "Local files");
				await clickInPodNotesView(obsidian, `[aria-label="More options for ${title}"]`);
				const removalMenu = await clickMenuItem(obsidian, "Remove from Local Files");
				expect(removalMenu).not.toContain("Remove download");
				await plugin.waitForData<PodNotesData>(
					(data) => !inDownloads(data) && !inLocalFiles(data),
					WAIT_OPTS,
				);

				const after = await evalJsonAsync<{ listed: boolean; original: boolean }>(
					obsidian,
					`(async () => {
					const view = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0]?.view;
					return {
						listed: Array.from(view?.containerEl.querySelectorAll(".pn-ep-title") ?? [])
							.some((candidate) => candidate.textContent?.trim() === ${jsLiteral(title)}),
						original: await app.vault.adapter.exists(${jsLiteral(audioPath)}),
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
				await evalJsonAsync<boolean>(
					obsidian,
					`(async () => {
					for (const path of ${jsLiteral(await trashedFixture())}) {
						await app.vault.adapter.remove(path);
					}
					return true;
				})()`,
				);
			}
		},
		60_000,
	);

	test("asks before trashing a download PodNotes cannot confirm it made", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const stamp = Date.now();
		const feed = `E2E Feed ${stamp}`;
		const kept = `E2E Adopted Recording ${stamp}`;
		const discarded = `E2E Discarded Recording ${stamp}`;
		const legacy = `E2E Legacy Recording ${stamp}`;
		const unindexed = `E2E Unindexed Recording ${stamp}`;
		const recordingPath = (title: string) => sandbox.path("Recordings", `${title}.wav`);
		const unindexedPath = sandbox.path(".recordings", `${unindexed}.wav`);
		const promptFor = (title: string) =>
			`PodNotes cannot confirm that it downloaded "${recordingPath(title)}".`;
		const inDownloads = (data: PodNotesData, podcastName: string, title: string) =>
			data.downloadedEpisodes?.[podcastName]?.some((entry) => entry.title === title) ?? false;
		const trashedFixtures = async () =>
			(await listTrash(obsidian)).filter((path) => path.includes(String(stamp)));
		const adoptedByAnOlderRelease = (title: string, filePath = recordingPath(title)) => ({
			title,
			description: `${title} description.`,
			content: "",
			podcastName: feed,
			url: "https://example.com/e2e/feed.xml",
			streamUrl: `https://example.com/e2e/${stamp}/${encodeURIComponent(title)}.wav`,
			feedUrl: "https://example.com/e2e/feed.xml",
			artworkUrl: "",
			episodeDate: "2026-06-30T09:00:00.000Z",
			duration: 1,
			mediaType: "audio",
			filePath,
			size: SILENT_WAV_SECOND_BYTES,
		});

		await sandbox.mkdir("Recordings");
		for (const title of [kept, discarded, legacy]) {
			await writeSilentWav(obsidian, recordingPath(title), 1);
			await sandbox.waitForExists(`Recordings/${title}.wav`, WAIT_OPTS);
		}
		await sandbox.mkdir(".recordings");
		await evalJsonAsync<boolean>(
			obsidian,
			`(async () => {
				await app.vault.adapter.writeBinary(${jsLiteral(unindexedPath)}, new ArrayBuffer(${SILENT_WAV_SECOND_BYTES}));
				return true;
			})()`,
		);
		await plugin.updateDataAndReload<Record<string, unknown>>((data) => {
			data.downloadedEpisodes = {
				[feed]: [
					adoptedByAnOlderRelease(kept),
					adoptedByAnOlderRelease(discarded),
					adoptedByAnOlderRelease(unindexed, unindexedPath),
				],
				"local file": [
					{
						title: legacy,
						description: "",
						content: "",
						podcastName: "local file",
						url: `[[${recordingPath(legacy)}]]`,
						streamUrl: `app://local/${recordingPath(legacy)}`,
						episodeDate: "2022-11-01T00:00:00.000Z",
						filePath: recordingPath(legacy),
						size: SILENT_WAV_SECOND_BYTES,
					},
				],
			};
			data.playedEpisodes = {};
		}, RELOAD_OPTIONS);
		await waitForPodNotesReady(obsidian);
		await openPodNotesView(obsidian);

		try {
			await showList(obsidian, "Local files");

			await clickInPodNotesView(obsidian, `[aria-label="More options for ${kept}"]`);
			await clickMenuItem(obsidian, "Remove download");
			expect(await removalPrompt(obsidian, recordingPath(kept))).toEqual({
				prompt: promptFor(kept),
				focused: "Keep file",
				original: true,
			});
			await clickModalButton(obsidian, "Keep file");
			await plugin.waitForData<PodNotesData>(
				(data) => !inDownloads(data, feed, kept),
				WAIT_OPTS,
			);

			await clickInPodNotesView(obsidian, `[aria-label="More options for ${discarded}"]`);
			await clickMenuItem(obsidian, "Remove download");
			expect(await removalPrompt(obsidian, recordingPath(discarded))).toEqual({
				prompt: promptFor(discarded),
				focused: "Keep file",
				original: true,
			});
			await clickModalButton(obsidian, "Delete file");
			await sandbox.waitForMissing(`Recordings/${discarded}.wav`, WAIT_OPTS);
			await plugin.waitForData<PodNotesData>(
				(data) => !inDownloads(data, feed, discarded),
				WAIT_OPTS,
			);

			await clickInPodNotesView(obsidian, `[aria-label="More options for ${legacy}"]`);
			await clickMenuItem(obsidian, "Remove from Local Files");
			await plugin.waitForData<PodNotesData>(
				(data) => !inDownloads(data, "local file", legacy),
				WAIT_OPTS,
			);

			await clickInPodNotesView(obsidian, `[aria-label="More options for ${unindexed}"]`);
			await clickMenuItem(obsidian, "Remove download");
			await plugin.waitForData<PodNotesData>(
				(data) => !inDownloads(data, feed, unindexed),
				WAIT_OPTS,
			);

			const after = await evalJsonAsync<Record<string, boolean>>(
				obsidian,
				`(async () => {
					const { adapter } = app.vault;
					return {
						prompt: Boolean(document.querySelector(".modal-container")),
						kept: await adapter.exists(${jsLiteral(recordingPath(kept))}),
						discarded: await adapter.exists(${jsLiteral(recordingPath(discarded))}),
						legacy: await adapter.exists(${jsLiteral(recordingPath(legacy))}),
						unindexed: await adapter.exists(${jsLiteral(unindexedPath)}),
					};
				})()`,
			);
			expect({ ...after, trashed: await trashedFixtures() }).toEqual({
				prompt: false,
				kept: true,
				discarded: false,
				legacy: true,
				unindexed: true,
				trashed: [`.trash/${discarded}.wav`],
			});
			expect(await obsidian.dev.runtimeErrors()).toEqual([]);
		} finally {
			await evalJsonAsync<boolean>(
				obsidian,
				`(async () => {
					for (const modal of document.querySelectorAll(".modal-container")) {
						if (modal.textContent.includes(${jsLiteral(String(stamp))})) {
							modal.querySelector(".modal-header-button")?.click();
						}
					}
					for (const path of ${jsLiteral(await trashedFixtures())}) {
						await app.vault.adapter.remove(path);
					}
					if (await app.vault.adapter.exists(${jsLiteral(unindexedPath)})) {
						await app.vault.adapter.remove(${jsLiteral(unindexedPath)});
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

async function removalPrompt(
	obsidian: ObsidianClient,
	path: string,
): Promise<{ prompt: string | null; focused: string | null; original: boolean }> {
	const original = `app.vault.adapter.exists(${jsLiteral(path)})`;
	await obsidian.waitFor(
		() =>
			evalJsonAsync<boolean>(
				obsidian,
				`(async () => Boolean(document.querySelector(".modal-container")) || !(await ${original}))()`,
			),
		{ ...WAIT_OPTS, message: `Removing ${path} neither asked nor removed it.` },
	);
	return evalJsonAsync(
		obsidian,
		`(async () => ({
			prompt: document.querySelector(".modal-container .modal-content p")?.textContent ?? null,
			focused: document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent : null,
			original: await ${original},
		}))()`,
	);
}

async function clickModalButton(obsidian: ObsidianClient, label: string): Promise<void> {
	const button = `Array.from(document.querySelectorAll(".modal-container button")).find((button) => button.textContent?.trim() === ${jsLiteral(label)})`;
	await obsidian.waitFor(() => obsidian.dev.evalJson<boolean>(`Boolean(${button})`), {
		...WAIT_OPTS,
		message: `Modal button "${label}" did not appear.`,
	});
	await evalJsonAsync<boolean>(obsidian, `(() => { ${button}.click(); return true; })()`);
}

async function clickMenuItem(obsidian: ObsidianClient, label: string): Promise<string[]> {
	const items = `Array.from(document.querySelectorAll(".menu .menu-item"))`;
	const titleOf = `(item) => item.querySelector(".menu-item-title")?.textContent?.trim()`;
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`${items}.map(${titleOf}).includes(${jsLiteral(label)})`,
			),
		{ ...WAIT_OPTS, message: `Menu item "${label}" did not appear.` },
	);
	return evalJsonAsync<string[]>(
		obsidian,
		`(() => {
			const items = ${items};
			const offered = items.map(${titleOf});
			items[offered.indexOf(${jsLiteral(label)})].click();
			return offered;
		})()`,
	);
}

async function clickInPodNotesView(obsidian: ObsidianClient, selector: string): Promise<void> {
	const findTarget = `app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0]?.view.containerEl.querySelector(${jsLiteral(selector)})`;
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`(() => { const target = ${findTarget}; return target instanceof HTMLElement && target.getBoundingClientRect().width > 0; })()`,
			),
		{ ...WAIT_OPTS, message: `${selector} is not visible in the PodNotes view.` },
	);
	await evalJsonAsync<boolean>(obsidian, `(() => { ${findTarget}.click(); return true; })()`);
}
