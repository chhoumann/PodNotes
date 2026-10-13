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

/** `ignored` is an error message to accept, and only that message. */
export async function assertNoRuntimeErrors(
	obsidian: ObsidianClient,
	ignored?: string,
): Promise<void> {
	const kept = (message: string) => !ignored || !message.trim().endsWith(ignored);
	const early = await obsidian.dev.evalJson<unknown>("window.__podnotesJourneyEarlyErrors");
	if (!Array.isArray(early)) throw new Error("The startup error recorder is missing.");
	const startup = early.filter(({ message }: { message: string }) => kept(message));
	if (startup.length) throw new Error(`Startup runtime errors: ${JSON.stringify(startup)}`);
	const errors = (await obsidian.dev.runtimeErrors()).filter(({ message }) => kept(message));
	if (errors.length) throw new Error(`Unrelated renderer errors: ${JSON.stringify(errors)}`);
	const { stdout } = await obsidian.exec("dev:errors");
	const logged = stdout
		.split("\n")
		.filter((line) => line.trim() && kept(line))
		.join("\n");
	if (logged && logged.trim() !== "No errors captured.")
		throw new Error(`Obsidian runtime errors: ${logged.trim()}`);
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
	back: byCss("Back button", `${PLAYER_VIEW} .pn-head button[aria-label^="Back to "]`),
	backTo: (label: string) =>
		byCss(
			`Back to ${label}`,
			`${PLAYER_VIEW} .pn-head button[aria-label=${q(`Back to ${label}`)}]`,
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
		elements: `[...document.querySelectorAll(${q(`${PLAYER_VIEW} button.pn-gridcard`)})].filter((button) => [${q(title)}, ${q(`${title}, feed didn't load`)}].includes(button.getAttribute("aria-label")))`,
	}),
	failedPodcastCard: (title: string) =>
		byCss(
			`podcast card ${title} with its feed error badge`,
			`${PLAYER_VIEW} button.pn-gridcard[aria-label=${q(`${title}, feed didn't load`)}]`,
		),
	episode: (title: string): UiTarget => ({
		name: `episode ${title}`,
		elements: `[...document.querySelectorAll(${q(`${PLAYER_VIEW} .pn-ep-main`)})].filter((el) => !el.closest(".episode-player") && el.querySelector(".pn-ep-title")?.textContent.trim() === ${q(title)})`,
	}),
	episodeLoading: byCss(
		"episode list loading",
		`${PLAYER_VIEW} .pn-count[role="status"]`,
		"Loading episodes",
	),
	noEpisodes: byCss("No episodes", `${PLAYER_VIEW} .pn-panel-empty`, "No episodes"),
	refreshEpisodes: byCss("Refresh episodes", `${PLAYER_VIEW} [aria-label="Refresh episodes"]`),
	podcastOptions: byCss(
		"Podcast options",
		`${PLAYER_VIEW} .pn-head button[aria-label="Podcast options"]`,
	),
	feedError: byCss("feed error banner", `${PLAYER_VIEW} .pn-banner[role="alert"]`),
	feedErrorAction: (label: string) =>
		byCss(
			`feed error banner ${label}`,
			`${PLAYER_VIEW} .pn-banner[role="alert"] button`,
			label,
		),
	playbackToggle: byCss(
		"on-screen playback toggle",
		`${PLAYER_VIEW} .episode-player button[aria-label="Toggle playback"]`,
	),
	episodeMenu: (title: string) =>
		byCss(
			`More options for ${title}`,
			`${PLAYER_VIEW} button[aria-label=${q(`More options for ${title}`)}]`,
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
	settingHeading: (name: string) =>
		byCss(
			`settings heading ${name}`,
			".modal.mod-settings .setting-item-heading .setting-item-name",
			name,
		),
	/** First run's field, or Add podcast's in the head. They share the label. */
	podcastSearch: byCss(
		"podcast search",
		`${PLAYER_VIEW} input[aria-label="Search or paste a link"]`,
	),
	addPodcastButton: byCss(
		"Library's Add podcast",
		`${PLAYER_VIEW} .pn-head button[aria-label="Add podcast"]`,
	),
	railSearch: byCss("rail's Add podcast", `${PLAYER_VIEW} nav.pn-rail button.pn-railsearch`),
	addPodcast: (title: string) =>
		byCss(`Add ${title}`, `${PLAYER_VIEW} button.pn-result[aria-label=${q(`Add ${title}`)}]`),
	podcastViewport: byCss("PodNotes view", PLAYER_VIEW),
	promptInput: byCss("prompt input", ".prompt .prompt-input"),
	suggestion: (text: string) => byCss(`suggestion ${text}`, ".prompt .suggestion-item", text),
	paletteCommand: (name: string): UiTarget => ({
		name: `palette command PodNotes: ${name}`,
		elements: `[...document.querySelectorAll(".prompt .suggestion-item")].filter((el) => el.querySelector(".suggestion-prefix")?.textContent === "PodNotes" && el.querySelector(".suggestion-title")?.textContent === ${q(`PodNotes${name}`)})`,
	}),
	pageScroller: byCss("page scroller", `${PLAYER_VIEW} .pn-scroll`),
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
	await typeText(obsidian, text);
}

/** Types into whatever has focus, as a user does who starts typing without a click. */
export async function typeText(obsidian: ObsidianClient, text: string): Promise<void> {
	await cdp(obsidian, "Input.insertText", { text });
}

export async function pressEscape(obsidian: ObsidianClient): Promise<void> {
	const escape = { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 };
	await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyDown", ...escape });
	await cdp(obsidian, "Input.dispatchKeyEvent", { type: "keyUp", ...escape });
}

/** Where the page's scroller is scrolled to, in whole pixels. */
export async function pageScrollTop(obsidian: ObsidianClient): Promise<number> {
	return await obsidian.dev.evalJson<number>(
		`Math.round(document.querySelector(${q(`${PLAYER_VIEW} .pn-scroll`)})?.scrollTop ?? -1)`,
	);
}

/** Turns the mouse wheel over the page, as a user scrolls, and resolves to where it came to rest. */
export async function scrollPage(obsidian: ObsidianClient, deltaY: number): Promise<number> {
	const { x, y } = await settledPoint(obsidian, ui.pageScroller);
	await cdp(obsidian, "Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x,
		y,
		deltaX: 0,
		deltaY,
	});
	let last = Number.NaN;
	return await obsidian.waitFor(
		async () => {
			const top = await pageScrollTop(obsidian);
			const settled = top > 0 && top === last;
			last = top;
			return settled ? top : false;
		},
		{ timeoutMs: 5_000, intervalMs: 150, message: "the page scrolled and came to rest" },
	);
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
		`[...document.querySelectorAll(${q(`${PLAYER_VIEW} .pn-ep-main`)})].filter((el) => !el.closest(".episode-player") && el.getClientRects().length > 0).map((el) => el.querySelector(".pn-ep-title")?.textContent.trim() ?? "")`,
	);
}

export type ShownResult = Readonly<{ label: string; title: string; via: string | null }>;

export async function shownResults(obsidian: ObsidianClient): Promise<ShownResult[]> {
	return await obsidian.dev.evalJson<ShownResult[]>(
		`[...document.querySelectorAll(${q(`${PLAYER_VIEW} button.pn-result`)})].map((el) => ({ label: el.getAttribute("aria-label"), title: el.querySelector(".t")?.textContent.trim() ?? "", via: el.querySelector(".pn-linkchip")?.textContent.trim() ?? null }))`,
	);
}

export type ShownMenuItem = Readonly<{ title: string; checked: boolean }>;

export async function shownMenu(obsidian: ObsidianClient): Promise<ShownMenuItem[]> {
	return await obsidian.dev.evalJson<ShownMenuItem[]>(
		`[...document.querySelectorAll(".menu .menu-item")].filter((el) => el.getClientRects().length > 0).map((el) => ({ title: el.querySelector(".menu-item-title")?.textContent.trim() ?? "", checked: el.classList.contains("mod-checked") }))`,
	);
}

export async function feedsLoading(obsidian: ObsidianClient): Promise<boolean> {
	return await obsidian.dev.evalJson<boolean>(`(() => {
		let states;
		app.plugins.plugins.${PLUGIN_ID}.feeds.subscribe((value) => (states = value))();
		return [...states.values()].some(({ status }) => status === "loading");
	})()`);
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

/** Opens the command palette with its hotkey, types `name` and clicks PodNotes' command. */
export async function runFromPalette(obsidian: ObsidianClient, name: string): Promise<void> {
	const hotkey = {
		key: "p",
		code: "KeyP",
		windowsVirtualKeyCode: 80,
		modifiers: process.platform === "darwin" ? 4 : 2,
	};
	for (const type of ["keyDown", "keyUp"])
		await cdp(obsidian, "Input.dispatchKeyEvent", { type, ...hotkey });
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
	await waitUntilShown(obsidian, ui.settingHeading("Playlists"));
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

export async function removePodcast(obsidian: ObsidianClient, title: string): Promise<void> {
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(title), { button: "right" });
	await click(obsidian, ui.menuItem("Remove podcast"));
	await obsidian.waitFor(async () => !(await isShown(obsidian, ui.podcastCard(title))), {
		timeoutMs: 10_000,
		intervalMs: 100,
		message: `${title}'s card gone from the Library`,
	});
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

export async function openInEditor(obsidian: ObsidianClient, notePath: string): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		const file = app.vault.getAbstractFileByPath(${q(notePath)});
		if (!file) throw new Error(${q(`${notePath} does not exist.`)});
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
		const leaf = app.workspace.getLeavesOfType("markdown").find((each) => each.view.file?.path === ${q(notePath)});
		if (!leaf) throw new Error(${q(`${notePath} is not open in an editor.`)});
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

export async function reloadObsidian(obsidian: ObsidianClient, ignored?: string): Promise<void> {
	await assertNoRuntimeErrors(obsidian, ignored);
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
