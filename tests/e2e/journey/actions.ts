import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchPodNotesInstance } from "../../../scripts/e2e-instance.mjs";
import type { ObsidianClient } from "obsidian-e2e";
import {
	loadRunnerConfig,
	resolveInstanceOptions,
	resolveProvisionOptions,
	waitForInstanceReady,
} from "obsidian-e2e/runner";
import { PLUGIN_ID, VIEW_TYPE, waitForPodNotesReady } from "../runtime";

export async function assertNoRuntimeErrors(obsidian: ObsidianClient): Promise<void> {
	const early = await obsidian.dev.evalJson<unknown[]>("window.__podnotesJourneyEarlyErrors");
	if (!Array.isArray(early)) throw new Error("The startup error recorder is missing.");
	if (early.length) throw new Error(`Startup runtime errors: ${JSON.stringify(early)}`);
	const errors = await obsidian.dev.runtimeErrors();
	if (errors.length) throw new Error(`Unrelated renderer errors: ${JSON.stringify(errors)}`);
	const { stdout } = await obsidian.exec("dev:errors");
	if (stdout.trim() !== "No errors captured.")
		throw new Error(`Obsidian runtime errors: ${stdout.trim()}`);
}

export type UiTarget = Readonly<{
	name: string;
	elements: string;
}>;

const q = JSON.stringify;

function byCss(name: string, selector: string, text?: string): UiTarget {
	const filter =
		text === undefined ? "" : `.filter((el) => el.textContent.trim() === ${q(text)})`;
	return { name, elements: `[...document.querySelectorAll(${q(selector)})]${filter}` };
}

const PLAYER_VIEW = `.workspace-leaf-content[data-type="${VIEW_TYPE}"] .podcast-view`;

function navItem(name: string, nav: string, label: string): UiTarget {
	return {
		name,
		elements: `[...document.querySelectorAll(${q(`${PLAYER_VIEW} ${nav} button.pn-navitem`)})].filter((el) => el.querySelector(".lbl")?.textContent.trim() === ${q(label)})`,
	};
}

export const ui = {
	firstRun: byCss("first run", `${PLAYER_VIEW} .pn-first-run h1`, "Add your first podcast"),
	firstRunSettings: byCss(
		"first run settings button",
		`${PLAYER_VIEW} .pn-first-run button[aria-label="PodNotes settings"]`,
	),
	libraryHead: byCss("Library page", `${PLAYER_VIEW} h1.pn-head-title`, "Library"),
	pageTitle: (title: string) =>
		byCss(`${title} page`, `${PLAYER_VIEW} :is(h1.pn-head-title, .pn-title h1)`, title),
	back: byCss("Back button", `${PLAYER_VIEW} button.pn-back`),
	backTo: (label: string) =>
		byCss(
			`Back to ${label}`,
			`${PLAYER_VIEW} button.pn-back[aria-label=${q(`Back to ${label}`)}]`,
		),
	listRow: (label: string) => navItem(`Library row ${label}`, ".pn-scroll > nav.pn-nav", label),
	rail: byCss("rail", `${PLAYER_VIEW} nav.pn-rail`),
	railItem: (label: string) => navItem(`rail item ${label}`, "nav.pn-rail", label),
	miniPlayer: byCss("mini player", `${PLAYER_VIEW} section.pn-mini`),
	openPlayer: byCss("mini player", `${PLAYER_VIEW} section.pn-mini button.pn-mini-open`),
	openPlayerFor: (title: string) =>
		byCss(
			`mini player of ${title}`,
			`${PLAYER_VIEW} section.pn-mini button[aria-label=${q(`Open player: ${title}`)}]`,
		),
	miniPlay: byCss("mini player Play", `${PLAYER_VIEW} section.pn-mini button[aria-label="Play"]`),
	miniPlayback: byCss(
		"mini player play/pause",
		`${PLAYER_VIEW} section.pn-mini :is(button[aria-label="Play"], button[aria-label="Pause"])`,
	),
	fullPlayer: byCss("full player", `${PLAYER_VIEW} section.pn-player`),
	collapsePlayer: byCss(
		"Collapse player",
		`${PLAYER_VIEW} section.pn-player button[aria-label="Collapse player"]`,
	),
	podcastCard: (title: string): UiTarget => ({
		name: `podcast card ${title}`,
		elements: `[...document.querySelectorAll(${q(`${PLAYER_VIEW} .podcast-grid button`)})].filter((button) => (button.getAttribute("aria-label") ?? button.querySelector("img")?.alt ?? button.textContent.trim()) === ${q(title)})`,
	}),
	episode: (title: string): UiTarget => ({
		name: `episode ${title}`,
		elements: `[...document.querySelectorAll(${q(`${PLAYER_VIEW} .podcast-episode-item`)})].filter((el) => !el.closest(".episode-player") && el.querySelector(".episode-item-title")?.textContent.trim() === ${q(title)})`,
	}),
	feedLoading: byCss("feed loading banner", `${PLAYER_VIEW} .feed-loading-banner`),
	episodeLoading: byCss("episode list loading", `${PLAYER_VIEW} .episode-list-loading`),
	refreshEpisodes: byCss("Refresh episodes", `${PLAYER_VIEW} [aria-label="Refresh episodes"]`),
	playbackToggle: byCss(
		"on-screen playback toggle",
		`${PLAYER_VIEW} .episode-player button[aria-label="Toggle playback"]`,
	),
	menuItem: (title: string): UiTarget => ({
		name: `menu item ${title}`,
		elements: `[...document.querySelectorAll(".menu .menu-item")].filter((el) => el.querySelector(".menu-item-title")?.textContent.trim() === ${q(title)})`,
	}),
	fileExplorerItem: (filePath: string) =>
		byCss(`file explorer item ${filePath}`, `.nav-file-title[data-path=${q(filePath)}]`),
	leftDrawerToggle: byCss("left sidebar toggle", ".sidebar-toggle-button.mod-left"),
	ribbonAction: (label: string) =>
		byCss(`ribbon action ${label}`, `.side-dock-ribbon-action[aria-label=${q(label)}]`),
	readingLink: (text: string) =>
		byCss(
			`Reading view link ${text}`,
			".workspace-leaf.mod-active .markdown-reading-view a",
			text,
		),
	settingsTab: (name: string) =>
		byCss(`settings tab ${name}`, ".modal.mod-settings .vertical-tab-nav-item", name),
	settingControl: (settingName: string, control: string): UiTarget => ({
		name: `${control} of setting ${settingName}`,
		elements: `[...document.querySelectorAll(".modal.mod-settings .setting-item")].filter((row) => row.querySelector(".setting-item-name")?.textContent.trim() === ${q(settingName)}).map((row) => row.querySelector(${q(control)})).filter(Boolean)`,
	}),
	podcastSearch: byCss(
		"podcast search",
		'.modal.mod-settings input[placeholder="Search or enter feed URL..."]',
	),
	addPodcast: (title: string) =>
		byCss(
			`Add ${title}`,
			`.modal.mod-settings button[aria-label=${q(`Add ${title} podcast`)}]`,
		),
	removePodcast: (title: string) =>
		byCss(
			`Remove ${title}`,
			`.modal.mod-settings button[aria-label=${q(`Remove ${title} podcast`)}]`,
		),
	podcastViewport: byCss("PodNotes view", PLAYER_VIEW),
} as const;

type Located =
	| { state: "ready"; x: number; y: number }
	| { state: "absent" | "hidden" | "ambiguous" | "covered"; detail: string };

async function locate(obsidian: ObsidianClient, target: UiTarget): Promise<Located> {
	return await obsidian.dev.evalJson<Located>(`(() => {
		const all = (${target.elements});
		const visible = all.filter((el) => el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden");
		if (visible.length === 0) return { state: all.length ? "hidden" : "absent", detail: String(all.length) };
		if (visible.length > 1) return { state: "ambiguous", detail: String(visible.length) };
		const el = visible[0];
		el.scrollIntoView({ block: "nearest", inline: "nearest" });
		const rect = el.getBoundingClientRect();
		const x = rect.left + rect.width / 2;
		const y = rect.top + rect.height / 2;
		const hit = document.elementFromPoint(x, y);
		if (!hit || !el.contains(hit)) return { state: "covered", detail: hit ? hit.outerHTML.slice(0, 120) : "nothing" };
		return { state: "ready", x, y };
	})()`);
}

async function settledPoint(
	obsidian: ObsidianClient,
	target: UiTarget,
	timeoutMs = 10_000,
): Promise<{ x: number; y: number }> {
	let previous = "";
	let last = "";
	return await obsidian
		.waitFor(
			async () => {
				const sample = await locate(obsidian, target);
				const key = JSON.stringify(sample);
				const settled = sample.state === "ready" && key === last;
				previous = last;
				last = key;
				return settled ? sample : false;
			},
			{ timeoutMs, intervalMs: 100, message: `${target.name} visible and still` },
		)
		.catch((error: Error) => {
			error.message += ` Last samples: ${previous}, ${last}.`;
			throw error;
		});
}

async function cdp(obsidian: ObsidianClient, method: string, params: object): Promise<unknown> {
	const { stdout } = await obsidian.exec("dev:cdp", { method, params: JSON.stringify(params) });
	const output = stdout.trim();
	if (output.startsWith("Error")) throw new Error(`${method}: ${output}`);
	return output ? JSON.parse(output) : undefined;
}

export async function click(
	obsidian: ObsidianClient,
	target: UiTarget,
	options: { button?: "left" | "right"; timeoutMs?: number } = {},
): Promise<void> {
	const { x, y } = await settledPoint(obsidian, target, options.timeoutMs);
	const button = options.button ?? "left";
	await cdp(obsidian, "Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp(obsidian, "Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
	}
}

export async function typeInto(
	obsidian: ObsidianClient,
	target: UiTarget,
	text: string,
	options: { replace?: boolean } = {},
): Promise<void> {
	await click(obsidian, target);
	if (options.replace) {
		const selectAll = {
			key: "a",
			windowsVirtualKeyCode: 65,
			modifiers: process.platform === "darwin" ? 4 : 2,
		};
		await cdp(obsidian, "Input.dispatchKeyEvent", {
			type: "keyDown",
			...selectAll,
			...(process.platform === "darwin" ? { commands: ["selectAll"] } : {}),
		});
		await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyUp", ...selectAll });
	}
	await cdp(obsidian, "Input.insertText", { text });
}

export async function pressEscape(obsidian: ObsidianClient): Promise<void> {
	const escape = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
	await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyDown", ...escape });
	await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyUp", ...escape });
}

export async function isShown(obsidian: ObsidianClient, target: UiTarget): Promise<boolean> {
	return (
		(await obsidian.dev.evalJson<number>(
			`(${target.elements}).filter((el) => el && el.getClientRects().length > 0).length`,
		)) > 0
	);
}

export async function waitUntilShown(
	obsidian: ObsidianClient,
	target: UiTarget,
	timeoutMs = 15_000,
): Promise<void> {
	await obsidian.waitFor(() => isShown(obsidian, target), {
		timeoutMs,
		intervalMs: 200,
		message: `${target.name} shown`,
	});
}

export async function listedEpisodes(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(${q(`${PLAYER_VIEW} .podcast-episode-item`)})].filter((el) => !el.closest(".episode-player") && el.getClientRects().length > 0).map((el) => el.querySelector(".episode-item-title")?.textContent.trim() ?? "")`,
	);
}

export async function shownText(obsidian: ObsidianClient): Promise<string> {
	return await obsidian.dev.evalJson<string>(
		`document.querySelector(${q(PLAYER_VIEW)})?.innerText ?? ""`,
	);
}

export async function notices(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>(
		`[...document.querySelectorAll(".notice")].map((notice) => notice.textContent.trim())`,
	);
}

export async function dismissNotices(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson(
		`document.querySelectorAll(".notice-container .notice").forEach((notice) => notice.remove()), true`,
	);
}

export async function runCommand(obsidian: ObsidianClient, id: string): Promise<void> {
	const { stdout } = await obsidian.exec("command", { id });
	if (/^Error/m.test(stdout)) throw new Error(`command ${id}: ${stdout.trim()}`);
}

export async function showPodNotes(obsidian: ObsidianClient): Promise<void> {
	await runCommand(obsidian, `${PLUGIN_ID}:podnotes-show-leaf`);
	await waitUntilShown(obsidian, ui.podcastViewport);
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
		await app.workspace.detachLeavesOfType(${q(VIEW_TYPE)});
		return true;
	})()`);
}

export async function openPodNotesSettings(obsidian: ObsidianClient): Promise<void> {
	await runCommand(obsidian, "app:open-settings");
	await click(obsidian, ui.settingsTab("PodNotes"));
	await waitUntilShown(obsidian, ui.podcastSearch);
}

export async function closeSettings(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson("app.setting.close(), true");
}

/**
 * Clicks `opener`, which must open a file chooser, and answers it with
 * `filePath` from disk through the real `<input type="file">`. Electron
 * ignores Chromium's chooser interception and opens a native dialog that
 * stays modal and blocks obsidian:// links until the app quits, so only the
 * dialog itself is held back while the test holds the chooser.
 */
export async function chooseFile(
	obsidian: ObsidianClient,
	opener: UiTarget,
	filePath: string,
): Promise<void> {
	await obsidian.dev.evalJson(`(() => {
		if (window.__podnotesJourneyChooser) throw new Error("A file chooser is already held.");
		const prototype = HTMLInputElement.prototype;
		const own = Object.getOwnPropertyDescriptor(prototype, "click");
		const click = prototype.click;
		const held = [];
		prototype.click = function () {
			if (this.type === "file") return void held.push(this);
			return click.call(this);
		};
		window.__podnotesJourneyChooser = { own, held };
		return true;
	})()`);
	try {
		await click(obsidian, opener);
		const input = await obsidian.waitFor(
			async () => {
				const evaluated = (await cdp(obsidian, "Runtime.evaluate", {
					expression: "window.__podnotesJourneyChooser.held.at(-1) ?? null",
				})) as { result: { objectId?: string } };
				return evaluated.result.objectId ?? false;
			},
			{ timeoutMs: 5_000, intervalMs: 100, message: "the file chooser to open" },
		);
		await cdp(obsidian, "DOM.setFileInputFiles", { objectId: input, files: [filePath] });
	} finally {
		await obsidian.dev.evalJson(`(() => {
			const { own } = window.__podnotesJourneyChooser;
			if (own) Object.defineProperty(HTMLInputElement.prototype, "click", own);
			else delete HTMLInputElement.prototype.click;
			delete window.__podnotesJourneyChooser;
			return true;
		})()`);
	}
}

export async function openInReadingView(obsidian: ObsidianClient, notePath: string): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = app.vault.getAbstractFileByPath(${q(notePath)});
		if (!file) throw new Error(${q(`${notePath} does not exist.`)});
		const leaf = app.workspace.getLeaf("tab");
		await leaf.openFile(file, { active: true, state: { mode: "preview" } });
		app.workspace.setActiveLeaf(leaf, { focus: true });
		return true;
	})()`);
}

export async function revealInFileExplorer(
	obsidian: ObsidianClient,
	filePath: string,
): Promise<void> {
	await runCommand(obsidian, "file-explorer:open");
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = app.vault.getAbstractFileByPath(${q(filePath)});
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

/**
 * Runner provisioning replaces the enabled-plugin list. Relaunch without it so
 * the startup recorder stays first. macOS needs app.quit because closing its last
 * window leaves it running.
 * `beforeClose` is renderer code that runs 50 ms before the window closes.
 */
export async function restartObsidian(
	obsidian: ObsidianClient,
	whileClosed: () => Promise<void> = async () => {},
	beforeClose = "",
): Promise<{ before: AppProcess; after: AppProcess }> {
	await assertNoRuntimeErrors(obsidian);
	const before = await appProcess(obsidian);
	const argv = await obsidian.dev.evalJson<string[]>("window.electron.remote.process.argv");
	const instance = await isolatedInstance();
	if (!argv.includes(`--user-data-dir=${instance.userDataPath}`))
		throw new Error("Refusing to quit a different Obsidian profile.");
	await assertSingleWindow(obsidian);
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
		await assertNoRuntimeErrors(obsidian);
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
	await assertNoRuntimeErrors(obsidian);
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
	await assertNoRuntimeErrors(obsidian);
	await dismissNotices(obsidian);
}

/** Switches Obsidian's mobile emulation, which reloads the app, and waits for PodNotes. */
export async function setMobileEmulation(obsidian: ObsidianClient, on: boolean): Promise<void> {
	await assertNoRuntimeErrors(obsidian);
	await obsidian.exec("dev:mobile", on ? { on: true } : { off: true });
	await obsidian.waitFor(
		async () =>
			await obsidian.dev
				.evalJson<boolean>(`app.isMobile === ${on} && app.workspace.layoutReady`)
				.catch(() => false),
		{ timeoutMs: 30_000, intervalMs: 500, message: `mobile emulation ${on ? "on" : "off"}` },
	);
	await waitForPodNotesReady(obsidian);
	await assertNoRuntimeErrors(obsidian);
	await dismissNotices(obsidian);
}
