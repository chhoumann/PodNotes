import type { PluginHandle } from "obsidian-e2e";
import { describe, expect, test } from "vitest";
import type { Episode } from "../../src/types/Episode";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";
import {
	createPodNotesE2EHarness,
	evalJsonAsync,
	openPodNotesView,
	PLUGIN_ID,
	RELOAD_OPTIONS,
	WAIT_OPTS,
	waitForPodNotesReady,
} from "./harness";

type PodNotesData = Partial<IPodNotesSettings>;

const AUDIO_BYTES = Uint8Array.from([
	0xff, 0xfb, 0x90, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
]);
const DOWNLOAD_URL = "https://e2e.podnotes.test/episode.mp3";
const getContext = createPodNotesE2EHarness("marketplace-review-runtime");

describe("marketplace review runtime paths", () => {
	test("renders searchable declarative settings and completes export/import with persistence", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const exportName = "marketplace-settings-export.json";
		const exportPath = sandbox.path(exportName);

		try {
			await openSettings(obsidian);

			const initial = await obsidian.dev.evalJson<{
				definitionCount: number;
				headings: string[];
				indexedAliases: number;
				renderedControls: number;
			}>(`
				(() => {
					const tab = app.setting.pluginTabs.find((candidate) => candidate.id === ${JSON.stringify(PLUGIN_ID)});
					const definitions = tab?.getSettingDefinitions?.() ?? [];
					return {
						definitionCount: definitions.length,
						headings: Array.from(document.querySelectorAll(".modal.mod-settings .setting-item-heading .setting-item-name"))
							.map((element) => element.textContent?.trim() ?? ""),
						indexedAliases: definitions.flatMap((definition) => definition.aliases ?? []).length,
						renderedControls: document.querySelectorAll(".modal.mod-settings .setting-item").length,
					};
				})()
			`);

			expect(initial.definitionCount).toBe(1);
			expect(initial.indexedAliases).toBe(29);
			expect(initial.renderedControls).toBeGreaterThan(25);
			expect(initial.headings).toEqual(
				expect.arrayContaining([
					"Search Podcasts",
					"Playlists",
					"Episode notes",
					"Feed notes",
					"Downloads",
					"Preferences & templates",
					"Transcripts",
				]),
			);
			expect(initial.headings).not.toContain("PodNotes");
			expect(initial.headings.every((heading) => !/settings/i.test(heading))).toBe(true);

			await evalJsonAsync<boolean>(
				obsidian,
				`(async () => {
					const input = document.querySelector('.modal.mod-settings input[placeholder="Search settings..."]');
					if (!(input instanceof HTMLInputElement)) throw new Error("Settings search input not found.");
					input.value = "Episode download path";
					input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
					return true;
				})()`,
			);
			await obsidian.waitFor(
				async () =>
					await obsidian.dev.evalJson<boolean>(
						'document.querySelector(".setting-search-results")?.textContent?.includes("Podcast preferences") ?? false',
					),
				WAIT_OPTS,
			);

			await evalJsonAsync<boolean>(
				obsidian,
				`(() => {
					app.setting.close();
					return true;
				})()`,
			);
			await openSettings(obsidian);
			await setSettingInputValue(obsidian, "Default Playback Rate", "1.5");
			await plugin.waitForData<PodNotesData>(
				(data) => data.defaultPlaybackRate === 1.5,
				WAIT_OPTS,
			);

			await setSettingInputValue(obsidian, "Export settings", exportPath);
			await clickSettingButton(obsidian, "Export settings", "Export");
			const exported = await sandbox.waitForContent(
				exportName,
				(contents) => contents.includes('"defaultPlaybackRate": 1.5'),
				WAIT_OPTS,
			);
			const envelope = JSON.parse(exported) as {
				settings: { defaultPlaybackRate?: number };
				type: string;
				version: number;
			};
			expect(envelope).toMatchObject({
				type: "podnotes-settings",
				version: 2,
				settings: { defaultPlaybackRate: 1.5 },
			});

			await setSettingInputValue(obsidian, "Default Playback Rate", "1.2");
			await plugin.waitForData<PodNotesData>(
				(data) => data.defaultPlaybackRate === 1.2,
				WAIT_OPTS,
			);

			await installFilePickerResult(obsidian, exported);
			await clickSettingButton(obsidian, "Import settings", "Import");
			await obsidian.waitFor(
				async () =>
					await obsidian.dev.evalJson<boolean>(`
						Array.from(document.querySelectorAll(".modal h3"))
							.some((heading) => heading.textContent?.trim() === "Import PodNotes settings?")
					`),
				WAIT_OPTS,
			);
			const confirmState = await obsidian.dev.evalJson<{
				destructive: boolean;
				fileInputWasAttached: boolean;
			}>(`
				(() => {
					const modal = Array.from(document.querySelectorAll(".modal")).find((candidate) =>
						Array.from(candidate.querySelectorAll("h3")).some(
							(heading) => heading.textContent?.trim() === "Import PodNotes settings?",
						),
					);
					const button = Array.from(modal?.querySelectorAll("button") ?? []).find(
						(candidate) => candidate.textContent?.trim() === "Import",
					);
					return {
						destructive: button?.classList.contains("mod-destructive") ?? false,
						fileInputWasAttached: window.__podnotesReviewFileInputAttached === true,
					};
				})()
			`);
			expect(confirmState).toEqual({ destructive: true, fileInputWasAttached: true });

			await evalJsonAsync<boolean>(
				obsidian,
				`(() => {
					const modal = Array.from(document.querySelectorAll(".modal")).find((candidate) =>
						Array.from(candidate.querySelectorAll("h3")).some(
							(heading) => heading.textContent?.trim() === "Import PodNotes settings?",
						),
					);
					const button = Array.from(modal?.querySelectorAll("button") ?? []).find(
						(candidate) => candidate.textContent?.trim() === "Import",
					);
					if (!(button instanceof HTMLButtonElement)) throw new Error("Import confirmation not found.");
					button.click();
					return true;
				})()`,
			);

			await plugin.waitForData<PodNotesData>(
				(data) => data.defaultPlaybackRate === 1.5,
				WAIT_OPTS,
			);
			await obsidian.waitFor(
				async () => await settingInputHasValue(obsidian, "Default Playback Rate", "1.5"),
				WAIT_OPTS,
			);
			expect(await obsidian.dev.runtimeErrors()).toEqual([]);
		} finally {
			await restoreFilePicker(obsidian);
			await evalJsonAsync<boolean>(
				obsidian,
				`(async () => {
					app.setting.close();
					const path = ${JSON.stringify(exportPath)};
					if (await app.vault.adapter.exists(path)) await app.vault.adapter.remove(path);
					return true;
				})()`,
			).catch(() => undefined);
		}
	}, 60_000);

	test("streams a ranged download through the real adapter and renders it in Local Files", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const episode = createEpisode("E2E Streaming Episode", DOWNLOAD_URL);
		const downloadPath = sandbox.path("downloads/{{title}}");
		const expectedPath = sandbox.path("downloads/E2E Streaming Episode.mp3");

		await seedEpisode(plugin, episode, (data) => {
			data.download = { path: downloadPath };
			data.downloadedEpisodes = {};
		});
		await waitForPodNotesReady(obsidian);
		await installDownloadInstrumentation(obsidian);

		try {
			await obsidian.command(`${PLUGIN_ID}:download-playing-episode`).run();
			await sandbox.waitForExists("downloads/E2E Streaming Episode.mp3", WAIT_OPTS);
			await plugin.waitForData<PodNotesData>(
				(data) =>
					data.downloadedEpisodes?.[episode.podcastName]?.[0]?.size ===
					AUDIO_BYTES.byteLength,
				WAIT_OPTS,
			);

			const downloaded = await evalJsonAsync<{
				appendCalls: number;
				bytes: number[];
				partialFiles: string[];
				renameCalls: number;
				requests: Array<{ range: string; url: string }>;
				writeCalls: number;
			}>(
				obsidian,
				`(async () => {
					const file = app.vault.getAbstractFileByPath(${JSON.stringify(expectedPath)});
					if (!file) throw new Error("Downloaded file was not indexed.");
					const bytes = new Uint8Array(await app.vault.readBinary(file));
					const listing = await app.vault.adapter.list(${JSON.stringify(sandbox.path("downloads"))});
					const calls = window.__podnotesReviewDownloadHooks.calls;
					return {
						appendCalls: calls.append.length,
						bytes: Array.from(bytes),
						partialFiles: listing.files.filter((path) => path.endsWith(".podnotes-partial")),
						renameCalls: calls.rename.length,
						requests: calls.requests,
						writeCalls: calls.write.length,
					};
				})()`,
			);
			expect(downloaded).toEqual({
				appendCalls: 1,
				bytes: Array.from(AUDIO_BYTES),
				partialFiles: [],
				renameCalls: 1,
				requests: [
					{ url: DOWNLOAD_URL, range: "bytes=0-4194303" },
					{ url: DOWNLOAD_URL, range: "bytes=8-15" },
				],
				writeCalls: 1,
			});

			await openPodNotesView(obsidian);
			await evalJsonAsync<boolean>(
				obsidian,
				`(async () => {
					const leaf = app.workspace.getLeaf("tab");
					await leaf.setViewState({ type: "podcast_player_view" });
					await app.workspace.revealLeaf(leaf);
					app.workspace.setActiveLeaf(leaf, { focus: true });
					return true;
				})()`,
			);
			await evalJsonAsync<boolean>(
				obsidian,
				`(() => {
					const gridButton = document.querySelector(
						'.workspace-leaf.mod-active .podcast-view button[aria-label="Podcast grid"]',
					);
					if (!(gridButton instanceof HTMLButtonElement)) {
						throw new Error("Podcast grid navigation button not found.");
					}
					gridButton.click();
					return true;
				})()`,
			);
			await obsidian.waitFor(
				async () =>
					await obsidian.dev.evalJson<boolean>(
						"Boolean(document.querySelector('.workspace-leaf.mod-active .podcast-view button.playlist-card[aria-label=\"Local Files\"]'))",
					),
				WAIT_OPTS,
			);
			await evalJsonAsync<boolean>(
				obsidian,
				`(() => {
					const localFiles = document.querySelector(
						'.workspace-leaf.mod-active .podcast-view button.playlist-card[aria-label="Local Files"]',
					);
					if (!(localFiles instanceof HTMLButtonElement)) throw new Error("Local Files card not found.");
					localFiles.click();
					return true;
				})()`,
			);
			await obsidian.waitFor(
				async () =>
					await obsidian.dev.evalJson<boolean>(
						`Boolean(document.querySelector(${JSON.stringify(`.workspace-leaf.mod-active [aria-label="More options for ${episode.title}"]`)}))`,
					),
				WAIT_OPTS,
			);
			const localFilesState = await obsidian.dev.evalJson<{
				episodeVisible: boolean;
				overflowVisible: boolean;
			}>(`
				(() => {
					const overflow = document.querySelector(
						${JSON.stringify(`.workspace-leaf.mod-active [aria-label="More options for ${episode.title}"]`)},
					);
					return {
						episodeVisible: Array.from(document.querySelectorAll(".workspace-leaf.mod-active .episode-item-title"))
							.some((candidate) => candidate.textContent?.trim() === ${JSON.stringify(episode.title)}),
						overflowVisible: overflow instanceof HTMLButtonElement && overflow.getBoundingClientRect().width > 0,
					};
				})()
			`);
			expect(localFilesState).toEqual({ episodeVisible: true, overflowVisible: true });
			expect(await obsidian.dev.runtimeErrors()).toEqual([]);
		} finally {
			await restoreDownloadInstrumentation(obsidian);
		}
	}, 60_000);

	test("finds a uniquely renamed episode note within only its expected folder", async () => {
		const { obsidian, plugin, sandbox } = getContext();
		const episode = createEpisode(
			"E2E Renamed Episode 42",
			"https://example.com/e2e-renamed-episode.mp3",
		);
		const noteTemplate = sandbox.path("notes/{{title}}.md");
		const renamedPath = sandbox.path("notes/E2E Renamed Episode 42 notes.md");
		const expectedPath = sandbox.path("notes/E2E Renamed Episode 42.md");

		await seedEpisode(plugin, episode, (data) => {
			data.note = { path: noteTemplate, template: "# {{title}}\n" };
		});
		await waitForPodNotesReady(obsidian);

		try {
			await evalJsonAsync<boolean>(
				obsidian,
				`(async () => {
					const folderPath = ${JSON.stringify(sandbox.path("notes"))};
					if (!app.vault.getAbstractFileByPath(folderPath)) await app.vault.createFolder(folderPath);
					await app.vault.create(
						${JSON.stringify(renamedPath)},
						${JSON.stringify("# Existing renamed note\n")},
					);
					return true;
				})()`,
			);

			await obsidian.command(`${PLUGIN_ID}:create-podcast-note`).run();
			await obsidian.waitFor(
				async () =>
					await obsidian.dev.evalJson<boolean>(
						`app.workspace.getActiveFile()?.path === ${JSON.stringify(renamedPath)}`,
					),
				WAIT_OPTS,
			);
			const state = await obsidian.dev.evalJson<{
				exactCreated: boolean;
				folderChildren: string[];
			}>(`
				(() => {
					const folder = app.vault.getAbstractFileByPath(${JSON.stringify(sandbox.path("notes"))});
					return {
						exactCreated: Boolean(app.vault.getAbstractFileByPath(${JSON.stringify(expectedPath)})),
						folderChildren: (folder?.children ?? []).map((child) => child.path),
					};
				})()
			`);
			expect(state.exactCreated).toBe(false);
			expect(state.folderChildren).toEqual([renamedPath]);
			expect(await obsidian.dev.runtimeErrors()).toEqual([]);
		} finally {
			await evalJsonAsync<boolean>(
				obsidian,
				`(async () => {
					if (await app.vault.adapter.exists(${JSON.stringify(renamedPath)})) {
						await app.vault.adapter.remove(${JSON.stringify(renamedPath)});
					}
					return true;
				})()`,
			).catch(() => undefined);
		}
	});

	test("copies the universal link through the real command and clipboard boundary", async () => {
		const { obsidian, plugin } = getContext();
		const episode = createEpisode(
			"E2E Clipboard Episode",
			"https://example.com/e2e-clipboard.mp3",
		);

		await seedEpisode(plugin, episode, (data) => {
			data.savedFeeds = {
				[episode.podcastName]: {
					title: episode.podcastName,
					url: episode.feedUrl ?? "",
					artworkUrl: "",
					collectionId: "42",
				},
			};
		});
		await waitForPodNotesReady(obsidian);
		await installClipboardInstrumentation(obsidian);

		try {
			await obsidian.command(`${PLUGIN_ID}:get-share-link-episode`).run();
			try {
				await obsidian.waitFor(
					async () =>
						await obsidian.dev.evalJson<boolean>(
							"window.__podnotesReviewClipboardHooks.writes.length === 1",
						),
					WAIT_OPTS,
				);
			} catch (error) {
				const debug = await obsidian.dev.evalJson<unknown>(`
					({
						redirected: window.__podnotesReviewClipboardHooks?.redirected ?? [],
						writes: window.__podnotesReviewClipboardHooks?.writes ?? [],
						notices: Array.from(document.querySelectorAll(".notice")).map((notice) => notice.textContent),
					})
				`);
				throw new Error(
					`Clipboard command did not settle: ${JSON.stringify({ debug, waitError: String(error) })}`,
				);
			}
			const state = await obsidian.dev.evalJson<{
				redirected: string[];
				writes: string[];
			}>(`
				({
					redirected: window.__podnotesReviewClipboardHooks.redirected,
					writes: window.__podnotesReviewClipboardHooks.writes,
				})
			`);
			expect(state.writes).toEqual(["https://pod.link/42/episode/e2e-episode-id"]);
			expect(state.redirected).toEqual(["https://pod.link/42.json?limit=1000"]);
			await obsidian.waitFor(
				async () =>
					await obsidian.dev.evalJson<boolean>(
						`Array.from(document.querySelectorAll(".notice"))
							.some((notice) => notice.textContent?.includes("Universal episode link copied to clipboard."))`,
					),
				WAIT_OPTS,
			);
			expect(await obsidian.dev.runtimeErrors()).toEqual([]);
		} finally {
			await restoreClipboardInstrumentation(obsidian);
		}
	});

	test("normalizes raw async rejection reasons to Error objects in the live bundle", async () => {
		const { obsidian } = getContext();
		const result = await evalJsonAsync<{
			lifecycle: { isError: boolean; message: string };
			retryAbort: { isError: boolean; message: string };
			snapshot: { isError: boolean; message: string };
		}>(
			obsidian,
			`(async () => {
				const podnotes = app.plugins.plugins.${PLUGIN_ID};
				const originalStructuredClone = window.structuredClone;
				let snapshot;
				try {
					window.structuredClone = () => { throw "raw snapshot failure"; };
					await podnotes.saveSettingsStrict();
					snapshot = { isError: false, message: "resolved" };
				} catch (error) {
					snapshot = { isError: error instanceof Error, message: error?.message ?? String(error) };
				} finally {
					window.structuredClone = originalStructuredClone;
				}

				const service = podnotes.getTranscriptionService();
				let lifecycle;
				try {
					await service.waitForLifecycle(Promise.reject("raw lifecycle failure"));
					lifecycle = { isError: false, message: "resolved" };
				} catch (error) {
					lifecycle = { isError: error instanceof Error, message: error?.message ?? String(error) };
				}

				const retryPromise = service.waitForRetry(10_000);
				service.lifetimeAbortController.abort("raw abort reason");
				let retryAbort;
				try {
					await retryPromise;
					retryAbort = { isError: false, message: "resolved" };
				} catch (error) {
					retryAbort = { isError: error instanceof Error, message: error?.message ?? String(error) };
				}

				return { lifecycle, retryAbort, snapshot };
			})()`,
		);

		expect(result).toEqual({
			lifecycle: { isError: true, message: "PodNotes transcription failed." },
			retryAbort: { isError: true, message: "PodNotes transcription was aborted." },
			snapshot: {
				isError: true,
				message: "PodNotes could not snapshot settings before saving.",
			},
		});
		expect(await obsidian.dev.runtimeErrors()).toEqual([]);
	});
});

function createEpisode(title: string, streamUrl: string): Episode {
	return {
		title,
		itunesTitle: title,
		streamUrl,
		url: streamUrl,
		feedUrl: "https://example.com/e2e-feed.xml",
		description: "",
		content: "",
		podcastName: "E2E Podcast",
		artworkUrl: "",
		mediaType: "audio",
	};
}

async function seedEpisode(
	plugin: PluginHandle,
	episode: Episode,
	mutate: (data: PodNotesData) => void = () => undefined,
): Promise<void> {
	await plugin.updateDataAndReload<PodNotesData>((data) => {
		data.currentEpisode = episode;
		data.playedEpisodes = {};
		mutate(data);
	}, RELOAD_OPTIONS);
}

async function openSettings(obsidian: Parameters<typeof evalJsonAsync>[0]): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`(async () => {
			app.setting.open();
			app.setting.closeActiveTab();
			app.setting.openTabById(${JSON.stringify(PLUGIN_ID)});
			await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
			return true;
		})()`,
	);
	await obsidian.waitFor(
		async () =>
			await obsidian.dev.evalJson<boolean>(`
				Array.from(document.querySelectorAll(".modal.mod-settings .setting-item-name"))
					.some((element) => element.textContent?.trim() === "Default Playback Rate")
			`),
		WAIT_OPTS,
	);
}

async function setSettingInputValue(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	settingName: string,
	value: string,
): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`(() => {
			const setting = Array.from(document.querySelectorAll(".modal.mod-settings .setting-item")).find(
				(candidate) => candidate.querySelector(".setting-item-name")?.textContent?.trim() === ${JSON.stringify(settingName)},
			);
			const input = setting?.querySelector("input");
			if (!(input instanceof HTMLInputElement)) {
				throw new Error(${JSON.stringify(`Input not found for ${settingName}.`)});
			}
			const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
			if (!setter) throw new Error("Native input value setter not found.");
			setter.call(input, ${JSON.stringify(value)});
			input.dispatchEvent(new Event("input", { bubbles: true }));
			input.dispatchEvent(new Event("change", { bubbles: true }));
			return true;
		})()`,
	);
}

async function settingInputHasValue(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	settingName: string,
	value: string,
): Promise<boolean> {
	return await obsidian.dev.evalJson<boolean>(`
		(() => {
			const setting = Array.from(document.querySelectorAll(".modal.mod-settings .setting-item")).find(
				(candidate) => candidate.querySelector(".setting-item-name")?.textContent?.trim() === ${JSON.stringify(settingName)},
			);
			return setting?.querySelector("input")?.value === ${JSON.stringify(value)};
		})()
	`);
}

async function clickSettingButton(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	settingName: string,
	buttonText: string,
): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`(() => {
			const setting = Array.from(document.querySelectorAll(".modal.mod-settings .setting-item")).find(
				(candidate) => candidate.querySelector(".setting-item-name")?.textContent?.trim() === ${JSON.stringify(settingName)},
			);
			const button = Array.from(setting?.querySelectorAll("button") ?? []).find(
				(candidate) => candidate.textContent?.trim() === ${JSON.stringify(buttonText)},
			);
			if (!(button instanceof HTMLButtonElement)) {
				throw new Error(${JSON.stringify(`${buttonText} button not found for ${settingName}.`)});
			}
			button.click();
			return true;
		})()`,
	);
}

async function installFilePickerResult(
	obsidian: Parameters<typeof evalJsonAsync>[0],
	contents: string,
): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`(() => {
			window.__podnotesReviewOriginalInputClick = HTMLInputElement.prototype.click;
			HTMLInputElement.prototype.click = function () {
				if (this.type !== "file") {
					return window.__podnotesReviewOriginalInputClick.call(this);
				}
				window.__podnotesReviewFileInputAttached = this.parentElement === activeDocument.body;
				const file = new File([${JSON.stringify(contents)}], "PodNotes_Settings.json", {
					type: "application/json",
				});
				Object.defineProperty(this, "files", { configurable: true, value: [file] });
				this.dispatchEvent(new Event("change", { bubbles: true }));
			};
			return true;
		})()`,
	);
}

async function restoreFilePicker(obsidian: Parameters<typeof evalJsonAsync>[0]): Promise<void> {
	await obsidian.dev
		.evalJson<boolean>(`
			(() => {
				if (window.__podnotesReviewOriginalInputClick) {
					HTMLInputElement.prototype.click = window.__podnotesReviewOriginalInputClick;
				}
				delete window.__podnotesReviewOriginalInputClick;
				delete window.__podnotesReviewFileInputAttached;
				return true;
			})()
		`)
		.catch(() => undefined);
}

async function installDownloadInstrumentation(
	obsidian: Parameters<typeof evalJsonAsync>[0],
): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`(() => {
			const adapter = app.vault.adapter;
			const ipc = window.electron.ipcRenderer;
			const originals = {
				appendBinary: adapter.appendBinary,
				ipcSend: ipc.send,
				rename: adapter.rename,
				writeBinary: adapter.writeBinary,
			};
			const calls = { append: [], rename: [], requests: [], write: [] };
			ipc.send = function (channel, ...args) {
				const [replyChannel, request] = args;
				if (
					channel === "request-url" &&
					typeof replyChannel === "string" &&
					request?.url === ${JSON.stringify(DOWNLOAD_URL)}
				) {
					const rangeHeader = request.headers?.Range ?? request.headers?.range ?? "";
					calls.requests.push({ url: request.url, range: rangeHeader });
					const match = /^bytes=(\\d+)-(\\d+)$/.exec(rangeHeader);
					const bytes = Uint8Array.from(${JSON.stringify(Array.from(AUDIO_BYTES))});
					const start = match ? Number(match[1]) : 0;
					const end = match ? Math.min(start + 7, bytes.byteLength - 1) : bytes.byteLength - 1;
					const body = bytes.slice(start, end + 1).buffer;
					queueMicrotask(() => ipc.emit(replyChannel, {}, {
						status: match ? 206 : 200,
						headers: {
							"content-length": String(body.byteLength),
							"content-range": match ? "bytes " + start + "-" + end + "/" + bytes.byteLength : undefined,
							"content-type": "audio/mpeg",
						},
						body,
					}));
					return;
				}
				return originals.ipcSend.call(ipc, channel, ...args);
			};
			adapter.writeBinary = async function (path, data) {
				calls.write.push({ path, size: data.byteLength });
				return await originals.writeBinary.call(adapter, path, data);
			};
			adapter.appendBinary = async function (path, data) {
				calls.append.push({ path, size: data.byteLength });
				return await originals.appendBinary.call(adapter, path, data);
			};
			adapter.rename = async function (from, to) {
				calls.rename.push({ from, to });
				return await originals.rename.call(adapter, from, to);
			};
			window.__podnotesReviewDownloadHooks = { adapter, calls, ipc, originals };
			return true;
		})()`,
	);
}

async function restoreDownloadInstrumentation(
	obsidian: Parameters<typeof evalJsonAsync>[0],
): Promise<void> {
	await obsidian.dev
		.evalJson<boolean>(`
			(() => {
				const hooks = window.__podnotesReviewDownloadHooks;
				if (!hooks) return true;
				hooks.adapter.appendBinary = hooks.originals.appendBinary;
				hooks.adapter.rename = hooks.originals.rename;
				hooks.adapter.writeBinary = hooks.originals.writeBinary;
				hooks.ipc.send = hooks.originals.ipcSend;
				delete window.__podnotesReviewDownloadHooks;
				return true;
			})()
		`)
		.catch(() => undefined);
}

async function installClipboardInstrumentation(
	obsidian: Parameters<typeof evalJsonAsync>[0],
): Promise<void> {
	await evalJsonAsync<boolean>(
		obsidian,
		`(() => {
			const ipc = window.electron.ipcRenderer;
			const writes = [];
			const redirected = [];
			const originalWriteText = navigator.clipboard.writeText;
			const originalSend = ipc.send;
			navigator.clipboard.writeText = async (value) => { writes.push(value); };
			ipc.send = function (channel, ...args) {
				const [replyChannel, request] = args;
				if (
					channel === "request-url" &&
					typeof replyChannel === "string" &&
					request?.url?.startsWith("https://pod.link/")
				) {
					redirected.push(request.url);
					const body = new TextEncoder().encode(JSON.stringify({
						episodes: [{ episodeId: "e2e-episode-id", title: "E2E Clipboard Episode" }],
					})).buffer;
					queueMicrotask(() => ipc.emit(replyChannel, {}, {
						status: 200,
						headers: { "content-type": "application/json" },
						body,
					}));
					return;
				}
				return originalSend.call(ipc, channel, ...args);
			};
			window.__podnotesReviewClipboardHooks = {
				ipc,
				originalSend,
				originalWriteText,
				redirected,
				writes,
			};
			return true;
		})()`,
	);
}

async function restoreClipboardInstrumentation(
	obsidian: Parameters<typeof evalJsonAsync>[0],
): Promise<void> {
	await obsidian.dev
		.evalJson<boolean>(`
			(() => {
				const hooks = window.__podnotesReviewClipboardHooks;
				if (!hooks) return true;
				hooks.ipc.send = hooks.originalSend;
				navigator.clipboard.writeText = hooks.originalWriteText;
				delete window.__podnotesReviewClipboardHooks;
				return true;
			})()
		`)
		.catch(() => undefined);
}
