import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchPodNotesInstance } from "../../../scripts/e2e-instance.mjs";
import type { ObsidianClient } from "obsidian-e2e";
import { onTestFinished } from "vitest";
import {
	loadRunnerConfig,
	resolveInstanceOptions,
	resolveProvisionOptions,
	waitForInstanceReady,
} from "obsidian-e2e/runner";
import { jsLiteral, PLUGIN_ID, VIEW_TYPE, waitForPodNotesReady } from "../runtime";
import { collectRuntimeErrors, POPOUT_RESIZE_LOOP } from "../runtime-evidence";
import { cdp, click, clickAt, type Point, pressHotkey, typeInto } from "./input";
import { PLAYER_VIEW, ui } from "./targets";
import { isShown, waitUntilShown } from "./wait";

export async function dismissNotices(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson(
		`document.querySelectorAll(".notice-container .notice").forEach((notice) => notice.remove()), true`,
	);
}

/**
 * Opens the command palette with its hotkey, types `name` and clicks PodNotes' command.
 * The hotkey needs the core plugin on, so this turns it on; the harness restores it.
 */
export async function runFromPalette(obsidian: ObsidianClient, name: string): Promise<void> {
	await obsidian.plugin("command-palette").enable({ filter: "core" });
	await pressHotkey(obsidian, "p");
	await typeInto(obsidian, ui.promptInput, name);
	await click(obsidian, ui.paletteCommand(name));
}

export async function runCommand(obsidian: ObsidianClient, id: string): Promise<void> {
	const { stdout } = await obsidian.exec("command", { id });
	if (/^Error/m.test(stdout)) throw new Error(`command ${id}: ${stdout.trim()}`);
}

export async function showPodNotes(obsidian: ObsidianClient): Promise<void> {
	await runCommand(obsidian, `${PLUGIN_ID}:podnotes-show-leaf`);
	await waitUntilShown(obsidian, ui.podcastViewport);
}

/**
 * Shows PodNotes in one leaf in the right sidebar, `width` px wide, in the main area,
 * wherever an earlier test or tool left it, or in the right drawer, where it opens on a
 * phone, and closes the leaves elsewhere.
 */
export async function placePodNotes(
	obsidian: ObsidianClient,
	place: { sidebar: number } | "main area" | "right drawer",
): Promise<void> {
	if (place === "right drawer") {
		await obsidian.dev.evalJson(
			`app.workspace.detachLeavesOfType(${jsLiteral(VIEW_TYPE)}), true`,
		);
		await showPodNotes(obsidian);
		await obsidian.waitFor(
			() =>
				obsidian.dev.evalJson<boolean>(
					`Boolean(document.querySelector(${jsLiteral(PLAYER_VIEW)})?.closest(".workspace-drawer.mod-right"))`,
				),
			{ timeoutMs: 5_000, intervalMs: 100, message: "PodNotes in the right drawer" },
		);
		return;
	}
	const sidebar = place !== "main area";
	await obsidian.dev.evalJsonAsync(`(async () => {
		const { workspace } = app;
		const inSidebar = (leaf) => leaf.getRoot() === workspace.rightSplit;
		for (const leaf of workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)}))
			if (inSidebar(leaf) !== ${sidebar}) leaf.detach();
		if (workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)}).length === 0) {
			let leaf = ${sidebar} ? workspace.getRightLeaf(false) : undefined;
			workspace.iterateRootLeaves((candidate) => {
				if (!${sidebar} && (!leaf || candidate.view.getViewType() === "empty")) leaf = candidate;
			});
			await leaf.setViewState({ type: ${jsLiteral(VIEW_TYPE)} });
		}
		return true;
	})()`);
	await showPodNotes(obsidian);
	if (!sidebar) return;
	// A tool such as the verify skill's screens.mjs can leave the window too small for it.
	await obsidian.dev.evalJson(`(() => {
		const win = require("@electron/remote").getCurrentWindow();
		const [width, height] = win.getContentSize();
		win.setContentSize(Math.max(width, ${place.sidebar + 400}), Math.max(height, 760));
		app.workspace.rightSplit.setSize(${place.sidebar});
		return true;
	})()`);
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`Math.round(document.querySelector(${jsLiteral(PLAYER_VIEW)})?.getBoundingClientRect().width ?? 0) === ${place.sidebar}`,
			),
		{ timeoutMs: 5_000, intervalMs: 100, message: `PodNotes ${place.sidebar} px wide` },
	);
}

/** Goes to the Library as a user does: closes the full player, then Back until the Library shows. */
export async function showLibrary(obsidian: ObsidianClient): Promise<void> {
	if (await isShown(obsidian, ui.fullPlayer)) await click(obsidian, ui.collapsePlayer);
	for (let step = 0; step < 5 && !(await isShown(obsidian, ui.libraryHead)); step++) {
		await click(obsidian, ui.back);
	}
	await waitUntilShown(obsidian, ui.libraryHead);
}

/** Opens a list from the Library's rows: Latest episodes, Queue, Playlists, Local files or Played. */
export async function showList(obsidian: ObsidianClient, label: string): Promise<void> {
	await showLibrary(obsidian);
	await click(obsidian, ui.listRow(label));
	await waitUntilShown(obsidian, ui.pageTitle(label));
}

export async function closePodNotes(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		await app.workspace.detachLeavesOfType(${jsLiteral(VIEW_TYPE)});
		return true;
	})()`);
}

/** Closes PodNotes and enables it again with no data.json, as a new install starts. */
export async function enableAsNewInstall(obsidian: ObsidianClient): Promise<void> {
	await closePodNotes(obsidian);
	const removed = await obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		const path = app.vault.configDir + ${jsLiteral(`/plugins/${PLUGIN_ID}/data.json`)};
		await app.workspace.saveLayout();
		await app.plugins.disablePlugin(${jsLiteral(PLUGIN_ID)});
		await app.vault.adapter.remove(path);
		const removed = !(await app.vault.adapter.exists(path));
		await app.plugins.enablePlugin(${jsLiteral(PLUGIN_ID)});
		return removed;
	})()`);
	if (!removed) throw new Error("data.json survived its removal, so this is not a new install.");
	await waitForPodNotesReady(obsidian);
}

export async function assertSettingsOpenInMainWindow(obsidian: ObsidianClient): Promise<void> {
	const popout = await obsidian.dev.evalJson<unknown>(
		'app.vault.getConfig("settingsPopoutWindow")',
	);
	if (popout !== false)
		throw new Error(
			`Obsidian's settingsPopoutWindow config is ${JSON.stringify(popout)}, so Settings opens in a popout window the tests cannot see. Restore "settingsPopoutWindow": false in the vault's .obsidian/app.json, or restart the instance: npm run stop:e2e-obsidian && npm run start:e2e-obsidian.`,
		);
}

export async function openPodNotesSettings(obsidian: ObsidianClient): Promise<void> {
	await assertSettingsOpenInMainWindow(obsidian);
	await runCommand(obsidian, "app:open-settings");
	await click(obsidian, ui.settingsTab("PodNotes"));
	await waitUntilShown(obsidian, ui.settingHeading("Notes"));
}

export async function showAddPodcast(obsidian: ObsidianClient): Promise<void> {
	if (await isShown(obsidian, ui.firstRun)) return;
	if (await isShown(obsidian, ui.rail)) await click(obsidian, ui.railSearch);
	else {
		await showLibrary(obsidian);
		await click(obsidian, ui.addPodcastButton);
	}
	await waitUntilShown(obsidian, ui.podcastSearch);
}

/**
 * Closes the Notice that starts with `message` as a user does, by clicking its text and
 * never a button in it, so it cannot cover what the test clicks next.
 */
export async function dismissNotice(obsidian: ObsidianClient, message: string): Promise<void> {
	let last = "";
	// A Notice slides in, so its text is clicked once it stands still.
	const point = await obsidian.waitFor(
		async () => {
			const sample = await obsidian.dev.evalJson<Point | null>(`(() => {
				const notice = [...document.querySelectorAll(".notice")].find((el) => el.textContent.trim().startsWith(${jsLiteral(message)}));
				const body = notice?.querySelector(".pn-undo-message") ?? notice?.querySelector(".notice-message") ?? notice;
				const text = body && [...body.childNodes].find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
				if (!text) return null;
				const range = document.createRange();
				range.selectNodeContents(text);
				const rect = range.getBoundingClientRect();
				const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
				const hit = document.elementFromPoint(point.x, point.y);
				return hit && notice.contains(hit) && !hit.closest("button") ? point : null;
			})()`);
			const key = JSON.stringify(sample);
			const settled = sample !== null && key === last;
			last = key;
			return settled ? sample : false;
		},
		{ timeoutMs: 10_000, intervalMs: 100, message: `the Notice "${message}" shown and still` },
	);
	await clickAt(obsidian, point);
	await obsidian.waitFor(
		async () =>
			!(await obsidian.dev.evalJson<boolean>(
				`[...document.querySelectorAll(".notice")].some((el) => el.textContent.trim().startsWith(${jsLiteral(message)}))`,
			)),
		{ timeoutMs: 5_000, intervalMs: 100, message: `the Notice "${message}" closed` },
	);
}

/** Removes a podcast from its card's menu, and closes the Notice that offers Undo. */
export async function removePodcast(obsidian: ObsidianClient, title: string): Promise<void> {
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(title), { button: "right" });
	await click(obsidian, ui.menuItem("Remove podcast"));
	await obsidian.waitFor(async () => !(await isShown(obsidian, ui.podcastCard(title))), {
		timeoutMs: 10_000,
		intervalMs: 100,
		message: `${title}'s card gone from the Library`,
	});
	await dismissNotice(obsidian, `Removed ${title}`);
}

export async function closeSettings(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson("app.setting.close(), true");
}

export async function openInReadingView(obsidian: ObsidianClient, notePath: string): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = app.vault.getAbstractFileByPath(${jsLiteral(notePath)});
		if (!file) throw new Error(${jsLiteral(`${notePath} does not exist.`)});
		const leaf = app.workspace.getLeaf("tab");
		await leaf.openFile(file, { active: true, state: { mode: "preview" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	})()`);
}

export async function openInEditor(obsidian: ObsidianClient, notePath: string): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = app.vault.getAbstractFileByPath(${jsLiteral(notePath)});
		if (!file) throw new Error(${jsLiteral(`${notePath} does not exist.`)});
		const leaf = app.workspace.getLeaf("tab");
		await leaf.openFile(file, { active: true, state: { mode: "source" } });
		return true;
	})()`);
}

/**
 * Renderer code that finds the markdown leaf showing `notePath` as `leaf`, and
 * defines `press(x, y)`, a real click at that point of the window holding it,
 * which CDP cannot reach when it is a popout.
 */
function inNoteWindow(notePath: string): string {
	return `
		const remote = require("@electron/remote");
		const leaf = app.workspace.getLeavesOfType("markdown").find((each) => each.view.file?.path === ${jsLiteral(notePath)});
		if (!leaf) throw new Error(${jsLiteral(`${notePath} is not open in an editor.`)});
		const main = remote.getCurrentWindow();
		const others = remote.BrowserWindow.getAllWindows().filter((win) => win.id !== main.id);
		if (leaf.view.containerEl.ownerDocument !== document && others.length !== 1)
			throw new Error("Expected exactly one popout window, found " + others.length + ".");
		const win = leaf.view.containerEl.ownerDocument === document ? main : others[0];
		const press = (x, y) => {
			const point = { x: Math.round(x), y: Math.round(y) };
			win.webContents.sendInputEvent({ type: "mouseMove", ...point });
			for (const type of ["mouseDown", "mouseUp"])
				win.webContents.sendInputEvent({ type, ...point, button: "left", clickCount: 1 });
		};`;
}

/**
 * Clicks the open editor of `notePath` at `line` and `ch` (both zero-based), in
 * whichever window holds it, and returns where the caret landed.
 */
export async function clickInEditor(
	obsidian: ObsidianClient,
	notePath: string,
	line: number,
	ch: number,
): Promise<{ line: number; ch: number }> {
	return await obsidian.dev.evalJsonAsync<{ line: number; ch: number }>(`(async () => {
		${inNoteWindow(notePath)}
		const { cm } = leaf.view.editor;
		const at = cm.coordsAtPos(cm.state.doc.line(${line + 1}).from + ${ch});
		press(at.left, (at.top + at.bottom) / 2);
		await new Promise((resolve) => setTimeout(resolve, 200));
		return leaf.view.editor.getCursor();
	})()`);
}

/** Clicks the close button of the popout tab showing `notePath`, which closes its window. */
export async function closePopoutTab(obsidian: ObsidianClient, notePath: string): Promise<void> {
	const closed = await obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		${inNoteWindow(notePath)}
		const close = leaf.tabHeaderEl.querySelector(".workspace-tab-header-inner-close-button").getBoundingClientRect();
		press(close.left + close.width / 2, close.top + close.height / 2);
		for (let i = 0; i < 50 && remote.BrowserWindow.getAllWindows().length > 1; i++)
			await new Promise((resolve) => setTimeout(resolve, 100));
		return remote.BrowserWindow.getAllWindows().length === 1;
	})()`);
	if (!closed) throw new Error(`The popout showing ${notePath} did not close.`);
}

/** Moves the PodNotes view into a new popout window, as the tab menu's "Move to new window" does. */
export async function moveViewToPopout(obsidian: ObsidianClient): Promise<void> {
	const moved = await obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		const leaf = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
		app.workspace.moveLeafToPopout(leaf);
		for (let i = 0; i < 50; i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			const moved = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
			if (moved?.view.containerEl.ownerDocument !== document) return true;
		}
		return false;
	})()`);
	if (!moved) throw new Error("The PodNotes view did not move to a popout.");
}

// Closes a popout left open, saves the layout so no reload reopens it, and reloads:
// closing a popout leaves Obsidian's layout observers looping in the main window for a
// while, and a fresh window keeps later tests clean.
export async function closePopoutAndReload(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJsonAsync<boolean>(`(async () => {
		require("@electron/remote").getCurrentWindow().show();
		const leaf = app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0];
		leaf?.detach();
		const windows = () => require("@electron/remote").BrowserWindow.getAllWindows().length;
		for (let i = 0; i < 50 && (app.workspace.floatingSplit.children.length > 0 || windows() > 1); i++) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		app.workspace.requestSaveLayout.cancel();
		await app.workspace.saveLayout();
		return true;
	})()`);
	await reloadAfterPopout(obsidian);
}

export async function revealInFileExplorer(
	obsidian: ObsidianClient,
	filePath: string,
): Promise<void> {
	await runCommand(obsidian, "file-explorer:open");
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = app.vault.getAbstractFileByPath(${jsLiteral(filePath)});
		const leaf = app.workspace.getLeavesOfType("file-explorer")[0];
		if (!file || !leaf) throw new Error("The file explorer or the file is missing.");
		await app.workspace.revealLeaf(leaf);
		leaf.view.revealInFolder(file);
		return true;
	})()`);
	await waitUntilShown(obsidian, ui.fileExplorerItem(filePath));
}

export type AppProcess = Readonly<{ mainPid: number; rendererPid: number }>;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

async function isolatedInstance() {
	const config = await loadRunnerConfig(REPO_ROOT);
	return resolveInstanceOptions(
		resolveProvisionOptions({}, config, REPO_ROOT),
		{},
		config,
		REPO_ROOT,
	);
}

async function appProcess(obsidian: ObsidianClient): Promise<AppProcess> {
	return await obsidian.dev.evalJson<AppProcess>(
		'({ mainPid: require("@electron/remote").process.pid, rendererPid: process.pid })',
	);
}

// What runner provisioning enforces in app.json before Obsidian starts.
const RUNNER_APP_CONFIG = { settingsPopoutWindow: false, spellcheck: false, trashOption: "local" };

async function writeRunnerAppConfig(vaultPath: string): Promise<void> {
	const file = path.join(vaultPath, ".obsidian", "app.json");
	let config: unknown;
	try {
		config = JSON.parse(await fs.readFile(file, "utf8"));
	} catch {
		// Missing, empty or cut off: nothing to keep.
	}
	const kept = config && typeof config === "object" && !Array.isArray(config) ? config : {};
	await fs.writeFile(file, `${JSON.stringify({ ...kept, ...RUNNER_APP_CONFIG }, null, "\t")}\n`);
}

/**
 * Runner provisioning replaces the enabled-plugin list. Relaunch without it so
 * the startup recorder stays first, but enforce its app.json settings again: a
 * quit can leave app.json empty, and Obsidian then opens Settings in a popout.
 * macOS needs app.quit because closing its last window leaves it running.
 * `beforeClose` is renderer code that runs 50 ms before the window closes.
 */
export async function restartObsidian(
	obsidian: ObsidianClient,
	whileClosed: () => Promise<void> = async () => {},
	beforeClose = "",
): Promise<{ before: AppProcess; after: AppProcess }> {
	const before = await appProcess(obsidian);
	const argv = await obsidian.dev.evalJson<string[]>("window.electron.remote.process.argv");
	const instance = await isolatedInstance();
	if (!argv.includes(`--user-data-dir=${instance.userDataPath}`))
		throw new Error("Refusing to quit a different Obsidian profile.");
	await assertSingleWindow(obsidian);
	await collectRuntimeErrors(obsidian);
	const close =
		process.platform === "darwin"
			? "window.electron.remote.app.quit()"
			: "electronWindow.close()";
	await obsidian.dev.evalJson(
		`(() => { ${beforeClose}; setTimeout(() => ${close}, 50); return true; })()`,
	);
	await obsidian.waitFor(() => !processAlive(before.mainPid), {
		timeoutMs: 30_000,
		intervalMs: 200,
		message: "Obsidian to quit",
	});
	let failure: { error: unknown } | undefined;
	try {
		await whileClosed();
	} catch (error) {
		failure = { error };
	}
	try {
		await writeRunnerAppConfig(instance.vaultPath);
		await launchPodNotesInstance(instance);
		await waitForInstanceReady(instance);
		await obsidian.waitFor(
			() =>
				obsidian.dev
					.evalJson<boolean>(
						"app.workspace.layoutReady && Boolean(app.plugins.plugins.podnotes?.api)",
					)
					.catch(() => false),
			{ timeoutMs: 30_000, intervalMs: 200, message: "Obsidian to relaunch" },
		);
		await waitForPodNotesReady(obsidian);
		await dismissNotices(obsidian);
	} catch (error) {
		if (failure)
			throw new AggregateError(
				[failure.error, error],
				"Restart fixture and relaunch failed.",
			);
		throw error;
	}
	if (failure) throw failure.error;
	return { before, after: await appProcess(obsidian) };
}

export async function assertSingleWindow(obsidian: ObsidianClient): Promise<void> {
	const windows = await obsidian.dev.evalJson<Array<{ id: number; url: string }>>(
		'require("@electron/remote").BrowserWindow.getAllWindows().map(win => ({ id: win.id, url: win.webContents.getURL() }))',
	);
	if (windows.length !== 1)
		throw new Error(
			`Expected one Obsidian window; found ${JSON.stringify(windows)}. Close extra vault windows before testing.`,
		);
}

function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export async function reloadObsidian(obsidian: ObsidianClient): Promise<void> {
	await reloadRenderer(obsidian);
}

/** Reloads after a popout closed, accepting exactly POPOUT_RESIZE_LOOP on both sides of the reload. */
export async function reloadAfterPopout(obsidian: ObsidianClient): Promise<void> {
	await reloadRenderer(obsidian, POPOUT_RESIZE_LOOP);
}

async function reloadRenderer(obsidian: ObsidianClient, ignored?: string): Promise<void> {
	await collectRuntimeErrors(obsidian, ignored);
	await obsidian.dev.evalJson("window.__podnotesJourneyBeforeReload = true");
	await obsidian.exec("reload");
	await obsidian.waitFor(
		async () =>
			await obsidian.dev
				.evalJson<boolean>(
					"!window.__podnotesJourneyBeforeReload && app.workspace.layoutReady",
				)
				.catch(() => false),
		{ timeoutMs: 30_000, intervalMs: 300, message: "Obsidian to reload" },
	);
	await waitForPodNotesReady(obsidian);
	await collectRuntimeErrors(obsidian, ignored);
	await dismissNotices(obsidian);
}

/**
 * Takes the renderer off the network, or back on, through Chromium's network
 * emulation, which also fires the window's offline or online event. Feed requests
 * run in Obsidian's main process and still reach the network, so a test also
 * disconnects its fixture server. A renderer reload goes back online.
 */
export async function setOffline(obsidian: ObsidianClient, offline: boolean): Promise<void> {
	await cdp(obsidian, "Network.emulateNetworkConditions", {
		offline,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	});
	await obsidian.waitFor(
		() => obsidian.dev.evalJson<boolean>(`navigator.onLine === ${!offline}`),
		{
			timeoutMs: 5_000,
			intervalMs: 100,
			message: `the renderer ${offline ? "offline" : "online"}`,
		},
	);
}

/** Obsidian's phone layout on a 390 x 844 screen, until the test ends. */
export async function asPhone(obsidian: ObsidianClient): Promise<void> {
	await cdp(obsidian, "Emulation.setDeviceMetricsOverride", {
		width: 390,
		height: 844,
		deviceScaleFactor: 1,
		mobile: true,
		screenWidth: 390,
		screenHeight: 844,
	});
	onTestFinished(async () => {
		await cdp(obsidian, "Emulation.clearDeviceMetricsOverride", {});
	});
	await setMobileEmulation(obsidian, true);
}

/** Switches Obsidian's mobile emulation, which reloads the app, and waits for PodNotes. */
export async function setMobileEmulation(obsidian: ObsidianClient, on: boolean): Promise<void> {
	await collectRuntimeErrors(obsidian);
	await obsidian.exec("dev:mobile", on ? { on: true } : { off: true });
	await obsidian.waitFor(
		async () =>
			await obsidian.dev
				.evalJson<boolean>(`app.isMobile === ${on} && app.workspace.layoutReady`)
				.catch(() => false),
		{ timeoutMs: 30_000, intervalMs: 500, message: `mobile emulation ${on ? "on" : "off"}` },
	);
	await waitForPodNotesReady(obsidian);
	await dismissNotices(obsidian);
}
