// Captures the docs screenshots in this worktree's isolated Obsidian, so they can
// be regenerated after any UI change. Run from the repo root:
//
//   npm run build && npm run start:e2e-obsidian
//   node docs/scripts/screenshots.mjs
//
// It drives the instance with the verify skill's screens tooling
// (.claude/skills/verify/screens): the fixture library seeds the podcasts, and
// the instance's pages and player give the view's shots. It copies the notes in
// docs/screenshots/vault into the instance's vault, creates episode notes and
// captures timestamps with PodNotes' own commands, and writes every shot at 2x,
// in light and dark, to docs/public/screenshots. It leaves the vault with an
// empty library, so seed it again before other verify work.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectCapture, videoToGif, withRecording, typeText } from "obsidian-e2e/capture";
import { execObsidian, obsidianCommandArgs, resolveInstanceOptions } from "obsidian-e2e/runner";
import sharp from "sharp";
import {
	config,
	evaluate,
	go,
	place,
	playback,
	press,
	provision,
	root,
	shot,
	theme,
	UI,
	waitFor,
} from "../../.claude/skills/verify/screens/instance.mjs";
import { library, seed } from "../../.claude/skills/verify/screens/scenes.mjs";

const docsDir = fileURLToPath(new URL("..", import.meta.url));
const seedDir = path.join(docsDir, "screenshots");
const outDir = path.join(docsDir, "public", "screenshots");
const work = path.join(root, ".obsidian-e2e-artifacts", "docs-screenshots");
const plan = JSON.parse(fs.readFileSync(path.join(seedDir, "seed.json"), "utf8"));
const instance = resolveInstanceOptions(provision, {}, config, root);
const THEMES = /** @type {const} */ (["light", "dark"]);
const HERO = { width: 1440, height: 900, sidebar: 360 };
const DEMO = { width: 1200, height: 900, sidebar: 360 };
const API = "app.plugins.plugins.podnotes.api";
// Linux draws scrollbars that macOS hides until you scroll, and window buttons
// that belong to the operating system, not to Obsidian.
const CAPTURE_CSS = "::-webkit-scrollbar, .titlebar-button-container { display: none; }";

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The instance's own CDP channel, the one the screens tooling emulates through. */
async function cdp(/** @type {string} */ method, params = {}) {
	const { stdout } = await execObsidian(
		instance,
		obsidianCommandArgs(instance.vaultName, [
			"dev:cdp",
			`method=${method}`,
			`params=${JSON.stringify(params)}`,
		]),
		{},
		{ timeout: 15000 },
	);
	if (!stdout.trim().startsWith("{")) throw new Error(`${method}: ${stdout}`);
	return JSON.parse(stdout);
}

/** Renders the current layout at 2x without moving anything. */
async function hiDpi() {
	const { width, height, phone } = await evaluate(
		`return { width: innerWidth, height: innerHeight, phone: app.isMobile };`,
	);
	await cdp("Emulation.setDeviceMetricsOverride", {
		width,
		height,
		deviceScaleFactor: 2,
		mobile: phone,
		...(phone && { screenWidth: width, screenHeight: height }),
	});
	await waitFor(`return devicePixelRatio === 2;`, "The window did not render at 2x", 5000);
}

/**
 * The view in the right sidebar, `sidebar` px wide, in a desktop window of
 * `width` x `height` with the file explorer open.
 */
async function desktop({ width, height, sidebar }) {
	await place("sidebar");
	await evaluate(`
		const win = require("electron").remote.getCurrentWindow();
		win.setContentSize(${width}, ${height});
		await new Promise((resolve) => setTimeout(resolve, 500));
		app.workspace.leftSplit.expand();
		app.workspace.rightSplit.setSize(${sidebar});
		return true;
	`);
	await waitFor(
		`return innerWidth === ${width} && innerHeight === ${height};`,
		`The window did not become ${width} x ${height}`,
		5000,
	);
	await hiDpi();
}

/** Opens a vault file in the one main-area tab and shows it in the file explorer. */
async function openFile(/** @type {string} */ file) {
	await evaluate(`
		const file = app.vault.getAbstractFileByPath(${JSON.stringify(file)});
		let leaf;
		app.workspace.iterateRootLeaves((candidate) => (leaf ??= candidate));
		await leaf.openFile(file);
		// iterateRootLeaves skips tabs Obsidian has not loaded yet, so walk the tree.
		const prune = (node) => {
			for (const child of [...(node.children ?? [])]) {
				if (child.children) prune(child);
				else if (child !== leaf) child.detach();
			}
		};
		prune(app.workspace.rootSplit);
		app.workspace.setActiveLeaf(leaf, { focus: false });
		const explorer = app.workspace.getLeavesOfType("file-explorer")[0];
		await explorer?.loadIfDeferred?.();
		explorer?.view.revealInFolder(file);
		return true;
	`);
	await waitFor(
		`return app.workspace.getActiveFile()?.path === ${JSON.stringify(file)};`,
		`${file} did not open`,
	);
}

/**
 * Writes `<name>.webp` in light and `<name>-dark.webp` in dark. `rect` is a page
 * function, as source, that returns the crop in CSS px. `focus` keeps the editor
 * focused, as the phone's editor toolbar needs. Obsidian's status bar would
 * float over the PodNotes view, so every shot hides it.
 * @param {string} name @param {string} rect
 * @param {{ css?: string, focus?: boolean }} [options]
 */
async function capture(name, rect, { css = "", focus = false } = {}) {
	fs.mkdirSync(work, { recursive: true });
	for (const name_ of THEMES) {
		await theme(name_);
		await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: -10, y: -10 });
		await evaluate(`
			document.getElementById("docs-capture")?.remove();
			document.head.createEl("style", { attr: { id: "docs-capture" },
				text: ${JSON.stringify(`${CAPTURE_CSS} .status-bar { display: none; } ${css}`)} });
			if (!${focus}) document.activeElement?.blur?.();
			document.querySelectorAll(".tooltip, .notice").forEach((el) => el.remove());
			return true;
		`);
		await waitFor(
			`return [...document.images].every((img) => {
				const r = img.getBoundingClientRect();
				return img.complete || r.width === 0 || r.bottom < 0 || r.top > innerHeight;
			});`,
			"Images did not load",
		);
		await sleep(600);
		const clip = await evaluate(`return (${rect})();`);
		const [x, y, width, height] = ["x", "y", "width", "height"].map((key) =>
			Math.round(clip[key]),
		);
		const { data } = await cdp("Page.captureScreenshot", {
			format: "png",
			clip: { x, y, width, height, scale: 1 },
		});
		const png = path.join(work, `${name}-${name_}.png`);
		fs.writeFileSync(png, Buffer.from(data, "base64"));
		await webp(png, name, name_);
	}
	await evaluate(`document.getElementById("docs-capture")?.remove(); return true;`);
}

/** @param {string} png @param {string} name @param {string} themeName */
async function webp(png, name, themeName) {
	fs.mkdirSync(outDir, { recursive: true });
	const out = path.join(outDir, `${name}${themeName === "dark" ? "-dark" : ""}.webp`);
	await sharp(png).webp({ quality: 86 }).toFile(out);
	console.log(path.relative(root, out));
}

/**
 * Shoots the PodNotes view, through the screens tooling, in both themes. `bottom`
 * is a page function, as source, that returns where to cut the shot, in CSS px
 * from the top of the view.
 * @param {string} name @param {string} [text] Text the view shows once it is ready.
 * @param {string} [bottom]
 */
async function viewShot(name, text, bottom) {
	fs.mkdirSync(work, { recursive: true });
	for (const name_ of THEMES) {
		await theme(name_);
		const png = path.join(work, `${name}-${name_}.png`);
		await shot(png, text, name_);
		if (bottom) {
			const cut = await evaluate(`
				const view = document.querySelector(".podcast-view").getBoundingClientRect();
				return Math.round((${bottom})() - view.top);
			`);
			const { width } = await sharp(png).metadata();
			const cropped = path.join(work, `${name}-${name_}-crop.png`);
			await sharp(png)
				.extract({ left: 0, top: 0, width, height: cut * 2 })
				.toFile(cropped);
			await webp(cropped, name, name_);
		} else {
			await webp(png, name, name_);
		}
	}
}

/** Opens a page of the view, with the full player over it or not. */
async function show(
	/** @type {import("../../.claude/skills/verify/screens/scenes.mjs").Page} */ page,
	player = false,
) {
	await go(page);
	await evaluate(
		`app.plugins.plugins.podnotes.navigation.${player ? "expand" : "collapse"}(); return true;`,
	);
}

/** The bottom edge of the last element matching `selector`, plus `pad`, as page source. */
const below = (/** @type {string} */ selector, pad = 16) =>
	`() => Math.max(...[...document.querySelectorAll(${JSON.stringify(selector)})]
		.filter((el) => el.getClientRects().length > 0)
		.map((el) => el.getBoundingClientRect().bottom)) + ${pad}`;

/** A crop of the open note's text column between two of its blocks, as page source. */
const noteCrop = (/** @type {string} */ from, /** @type {string} */ to) => `() => {
	const leaf = app.workspace.getLeavesOfType("markdown")[0].view;
	const view = leaf.contentEl;
	const pane = view.getBoundingClientRect();
	const header = leaf.containerEl.querySelector(".view-header").getBoundingClientRect();
	const column = view.querySelector(".cm-sizer").getBoundingClientRect();
	const blocks = [...view.querySelectorAll(".inline-title, .metadata-container, .cm-line, .callout")];
	// On a phone the header floats over the note, and the navigation bar sits over its bottom.
	const navbar = document.querySelector(".mobile-navbar")?.getBoundingClientRect().top ?? innerHeight;
	const top = Math.max(pane.top, header.bottom + 12, (${from})(blocks).getBoundingClientRect().top - 16);
	const bottom = Math.min(pane.bottom, navbar - 12, (${to})(blocks).getBoundingClientRect().bottom + 12);
	const left = Math.max(pane.left, column.x - 16);
	const right = Math.min(pane.right, column.right + 16);
	return { x: left, y: top, width: right - left, height: bottom - top };
}`;
const TITLE = `(blocks) => blocks.find((el) => el.matches(".inline-title"))`;
const CALLOUT = `(blocks) => blocks.find((el) => el.matches(".callout"))`;
const NOTES_HEADING = `(blocks) => blocks.find((el) => el.textContent.trim() === "Notes")`;
const LAST_LINE = `(blocks) => blocks.filter((el) => el.matches(".cm-line") && el.textContent.trim()).at(-1)`;
const LAST_TIMESTAMP = `(blocks) => blocks.filter((el) => /\\d\\d:\\d\\d:\\d\\d/.test(el.textContent)).at(-1)`;
const VIEWPORT = `() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight })`;
const BASES_TABLE = `() => {
	const box = document.querySelector('.workspace-leaf-content[data-type="bases"]').getBoundingClientRect();
	const rows = [...document.querySelectorAll('.workspace-leaf-content[data-type="bases"] .bases-tr')];
	const top = rows[0].getBoundingClientRect().top - 12;
	const last = rows.at(-1).getBoundingClientRect();
	const right = Math.max(...rows.flatMap((row) => [...row.children].map((cell) => cell.getBoundingClientRect().right)));
	return { x: box.x, y: top, width: Math.min(box.width, right - box.x + 24),
		height: Math.min(innerHeight, last.bottom + 24) - top };
}`;
// The PodNotes view in a phone's right drawer, down to the full player's panel
// buttons. The drawer's own tab switcher and file details sit below it.
const DRAWER_PLAYER = `() => {
			const view = document.querySelector(".workspace-drawer.mod-right .podcast-view").getBoundingClientRect();
			const panels = document.querySelector(".workspace-drawer.mod-right section.pn-player .pn-switch").getBoundingClientRect();
			return { x: view.x, y: view.y, width: view.width, height: panels.bottom + 12 - view.y };
		}`;
// PodNotes' own properties hold the fixture server's address, which says nothing
// to a reader, so the note's shots hide them.
const HIDE_ID_PROPERTIES =
	'.metadata-property:is([data-property-key="guid" i], [data-property-key="feedurl" i]) { display: none; }';

/** @param {Awaited<ReturnType<typeof library>>} lib @param {string} podcast @param {string} title */
function episode(lib, podcast, title) {
	const found = lib.feeds
		.find(({ feed }) => feed.title.startsWith(podcast))
		?.episodes.find((candidate) => candidate.title.startsWith(title));
	if (!found) throw new Error(`The fixture library has no episode "${title}" in ${podcast}.`);
	return found;
}

/**
 * The verify skill's listening library without its podcast whose feed answers
 * 404, and with the docs' note template.
 * @type {import("../../.claude/skills/verify/screens/scenes.mjs").Ingredient}
 */
function docsLibrary(data, lib) {
	const missing = new Set(lib.feeds.filter((feed) => feed.missing).map(({ feed }) => feed.title));
	const kept = (/** @type {{ podcastName: string }} */ item) => !missing.has(item.podcastName);
	for (const title of missing) delete data.savedFeeds[title];
	data.queue.episodes = data.queue.episodes.filter(kept);
	data.favorites.episodes = data.favorites.episodes.filter(kept);
	for (const list of Object.values(data.playlists)) list.episodes = list.episodes.filter(kept);
	for (const [key, record] of Object.entries(data.playedEpisodes)) {
		if (!kept(record)) delete data.playedEpisodes[key];
	}
	data.note.template = plan.noteTemplate;
}

/** Replaces the instance vault's files with docs/screenshots/vault and sets up Obsidian for it. */
async function prepareVault() {
	for (const entry of fs.readdirSync(provision.vaultPath)) {
		if (entry !== ".obsidian")
			fs.rmSync(path.join(provision.vaultPath, entry), { recursive: true });
	}
	await waitFor(
		`return app.vault.getFiles().length === 0;`,
		"Obsidian still lists files that were deleted",
	);
	fs.cpSync(path.join(seedDir, "vault"), provision.vaultPath, { recursive: true });
	await evaluate(`
		for (const id of ["file-explorer", "command-palette", "properties", "bases", "page-preview", "outline", "word-count"]) {
			const plugin = app.internalPlugins.getPluginById(id);
			if (plugin && !plugin.enabled) await plugin.enable(true);
		}
		app.vault.setConfig("showInlineTitle", true);
		app.vault.setConfig("readableLineLength", true);
		app.vault.setConfig("mobileToolbarCommands", ["podnotes:capture-timestamp",
			"editor:toggle-bold", "editor:insert-wikilink", "editor:toggle-checklist-status", "editor:undo"]);
		return true;
	`);
	await waitFor(
		`return Boolean(app.vault.getAbstractFileByPath("PodNotes/Episodes.base"));`,
		"Obsidian did not index the docs vault",
	);
}

/** Plays an episode from its podcast's page, as a listener does, then pauses it. */
async function load(/** @type {{ title: string, podcastName: string }} */ item) {
	await show({ kind: "feed", key: item.podcastName });
	execFileSync(
		process.execPath,
		[UI, "click", ".podcast-view .pn-ep-main", "--text", item.title.slice(0, 40)],
		{ stdio: "inherit" },
	);
	await waitFor(
		`let state; app.plugins.plugins.podnotes.player.state.subscribe((value) => (state = value))();
		return state.status === "playing" && state.episode.title === ${JSON.stringify(item.title)};`,
		`${item.title} did not play`,
	);
	await evaluate(`app.plugins.plugins.podnotes.player.pause(); return true;`);
}

/**
 * Creates the loaded episode's note with Create episode note, fills in its
 * properties, and writes its notes, capturing each `{{at h:mm:ss}}` line with
 * PodNotes' own capture.
 * @param {{ title: string, notes?: string, status: string, rating?: number, rename?: string }} entry
 */
async function writeNote(entry) {
	const before = await evaluate(`return app.workspace.getActiveFile()?.path ?? null;`);
	await evaluate(`app.commands.executeCommandById("podnotes:create-podcast-note"); return true;`);
	await waitFor(
		`const file = app.workspace.getActiveFile()?.path;
		return Boolean(file) && file !== ${JSON.stringify(before)} && file.startsWith("PodNotes/");`,
		`The note for ${entry.title} did not open`,
	);
	await evaluate(`
		await app.fileManager.processFrontMatter(app.workspace.getActiveFile(), (fm) => {
			fm.status = ${JSON.stringify(entry.status)};
			if (${JSON.stringify(entry.rating ?? null)} !== null) fm.rating = ${JSON.stringify(entry.rating ?? null)};
		});
		return true;
	`);
	await waitFor(
		`return app.workspace.activeEditor?.editor?.getValue().includes(${JSON.stringify(`status: ${entry.status}`)});`,
		`The properties of ${entry.title} did not reach the editor`,
	);
	const lines = entry.notes
		? fs
				.readFileSync(path.join(seedDir, "notes", entry.notes), "utf8")
				.trimEnd()
				.split("\n")
		: [];
	for (const line of lines) {
		const at = line.match(/^\{\{at (\d+):(\d\d):(\d\d)\}\} (.*)$/);
		await evaluate(`
			const editor = app.workspace.activeEditor.editor;
			editor.focus();
			editor.setCursor(editor.lastLine(), editor.getLine(editor.lastLine()).length);
			return true;
		`);
		if (at) {
			const seconds = Number(at[1]) * 3600 + Number(at[2]) * 60 + Number(at[3]);
			const result = await evaluate(`
				${API}.currentTime = ${seconds};
				return await app.plugins.plugins.podnotes.capture.timestamp();
			`);
			if (result?.destination !== "editor") {
				throw new Error(`The capture went to ${JSON.stringify(result)}, not the note.`);
			}
		}
		await evaluate(
			`app.workspace.activeEditor.editor.replaceSelection(${JSON.stringify(`${at ? at[4] : line}\n`)}); return true;`,
		);
	}
	await evaluate(`await app.workspace.activeEditor.save(); return true;`);
	if (!entry.rename) return await evaluate(`return app.workspace.getActiveFile().path;`);
	return await evaluate(`
		const file = app.workspace.getActiveFile();
		await app.fileManager.renameFile(file, file.parent.path + "/" + ${JSON.stringify(`${entry.rename}.md`)});
		return file.path;
	`);
}

/** Creates a podcast's feed note with Create podcast feed note and its picker. */
async function writeFeedNote(/** @type {string} */ podcast) {
	const before = await evaluate(`return app.workspace.getActiveFile()?.path ?? null;`);
	await evaluate(
		`app.commands.executeCommandById("podnotes:create-podcast-feed-note"); return true;`,
	);
	await waitFor(`return Boolean(document.querySelector(".prompt-input"));`, "No podcast picker");
	execFileSync(process.execPath, [UI, "fill", ".prompt-input", podcast], { stdio: "inherit" });
	execFileSync(process.execPath, [UI, "click", ".suggestion-item", "--text", podcast], {
		stdio: "inherit",
	});
	await waitFor(
		`const file = app.workspace.getActiveFile()?.path;
		return Boolean(file) && file !== ${JSON.stringify(before)} && file.startsWith("PodNotes/Podcasts/");`,
		`The feed note for ${podcast} did not open`,
	);
}

/** Folds or unfolds the open note's properties. */
async function showProperties(/** @type {boolean} */ open) {
	await evaluate(`
		const box = app.workspace.getLeavesOfType("markdown")[0].view.contentEl.querySelector(".metadata-container");
		if (box.classList.contains("is-collapsed") === ${open}) box.querySelector(".metadata-properties-heading").click();
		await new Promise((resolve) => setTimeout(resolve, 300));
		return true;
	`);
}

/** Scrolls the open note so `line` sits near the top, or to the top for "". */
async function scrollNote(/** @type {string} */ line) {
	await evaluate(`
		const editor = app.workspace.getLeavesOfType("markdown")[0].view.editor;
		const view = editor.cm;
		const index = [...Array(editor.lineCount()).keys()].find((i) => editor.getLine(i) === ${JSON.stringify(line)}) ?? 0;
		view.scrollDOM.scrollTop = ${JSON.stringify(line)} ? view.lineBlockAt(view.state.doc.line(index + 1).from).top - 40 : 0;
		await new Promise((resolve) => setTimeout(resolve, 300));
		return true;
	`);
}

/** Puts the cursor at the end of the open note's last timestamp line. */
async function cursorAfterLastTimestamp() {
	await evaluate(`
		const editor = app.workspace.getLeavesOfType("markdown")[0].view.editor;
		const last = [...Array(editor.lineCount()).keys()].findLast((i) => /^- \\[\\d/.test(editor.getLine(i)));
		editor.focus();
		editor.setCursor(last, editor.getLine(last).length);
		return true;
	`);
}

/**
 * Records the README demo in one theme: capture a timestamp from the command
 * palette, then type a note after it. The note goes in through the editor,
 * because the headless window does not keep keyboard focus in the editor.
 * @param {string} heroNote @param {"light" | "dark"} themeName
 */
async function recordDemo(heroNote, themeName) {
	const text = await evaluate(
		`return await app.vault.adapter.read(${JSON.stringify(heroNote)});`,
	);
	await theme(themeName);
	await evaluate(`
		app.internalPlugins.getPluginById("command-palette").instance.recentCommands = [];
		document.getElementById("docs-capture")?.remove();
		document.head.createEl("style", { attr: { id: "docs-capture" },
			text: ${JSON.stringify(`${CAPTURE_CSS} .status-bar { display: none; }`)} });
		app.workspace.leftSplit.collapse();
		const editor = app.workspace.getLeavesOfType("markdown")[0].view.editor;
		const lines = [...Array(editor.lineCount()).keys()];
		const last = lines.findLast((i) => /^- \\[\\d/.test(editor.getLine(i)));
		editor.focus();
		editor.setCursor(last, editor.getLine(last).length);
		editor.replaceSelection("\\n");
		// The note is too short to scroll its Notes heading to the top, so start at the artwork.
		const artwork = lines.find((i) => editor.getLine(i).startsWith("!["));
		editor.cm.scrollDOM.scrollTop = editor.cm.lineBlockAt(editor.cm.state.doc.line(artwork + 1).from).top - 16;
		${API}.currentTime = ${plan.demo.at};
		${API}.start();
		return true;
	`);
	await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: -10, y: -10 });
	await sleep(800);
	const port = fs
		.readFileSync(path.join(instance.userDataPath, "DevToolsActivePort"), "utf8")
		.split("\n")[0];
	const client = await connectCapture({ port: Number(port), timeoutMs: 30000 });
	const video = path.join(work, `demo-${themeName}.mp4`);
	try {
		await withRecording(
			client,
			video,
			async () => {
				await sleep(1200);
				await evaluate(
					`app.commands.executeCommandById("command-palette:open"); return true;`,
				);
				await sleep(500);
				await typeText(client, "capture timestamp", {
					delayMs: 70,
					selector: ".prompt-input",
				});
				await sleep(700);
				execFileSync(process.execPath, [UI, "key", "Enter"]);
				await sleep(900);
				await evaluate(`
					const editor = app.workspace.getLeavesOfType("markdown")[0].view.editor;
					for (const ch of ${JSON.stringify(plan.demo.note)}) {
						editor.replaceSelection(ch);
						await new Promise((resolve) => setTimeout(resolve, 45));
					}
					return true;
				`);
				await sleep(2200);
			},
			{ fps: 24, backend: "screencast" },
		);
	} finally {
		client.close();
	}
	await videoToGif(video, path.join(outDir, `demo${themeName === "dark" ? "-dark" : ""}.gif`), {
		width: DEMO.width,
		fps: 12,
	});
	console.log(`docs/public/screenshots/demo${themeName === "dark" ? "-dark" : ""}.gif`);
	await evaluate(`
		${API}.stop();
		await app.vault.adapter.write(${JSON.stringify(heroNote)}, ${JSON.stringify(text)});
		document.getElementById("docs-capture")?.remove();
		app.workspace.leftSplit.expand();
		return true;
	`);
	await sleep(800);
}

async function main() {
	const lib = await library();
	await prepareVault();
	await seed("lists", docsLibrary);

	// Each episode's note, made as a listener makes it. The last one stays loaded.
	// With the automatic queue off, the queue stays as the scene seeded it.
	await place("pane");
	await evaluate("app.plugins.plugins.podnotes.setAutoQueue(false); return true;");
	/** @type {Map<string, string>} */
	const notes = new Map();
	for (const entry of plan.episodes) {
		const item = episode(lib, entry.podcast, entry.title);
		await load(item);
		notes.set(entry.title, await writeNote({ ...entry, title: item.title }));
	}
	await evaluate("app.plugins.plugins.podnotes.setAutoQueue(true); return true;");
	for (const podcast of plan.feedNotes) await writeFeedNote(podcast);
	const hero = plan.episodes.at(-1);
	const heroNote = /** @type {string} */ (notes.get(hero.title));
	await playback(hero.playAt);

	// The view in the right sidebar.
	await place("sidebar");
	await hiDpi();
	await show({ kind: "library" });
	await viewShot("podcast-grid", "Podcasts", below(".podcast-view .pn-grid"));
	await show({ kind: "feed", key: episode(lib, hero.podcast, hero.title).podcastName });
	await viewShot("episode-list", hero.title);
	await show({ kind: "queue" });
	await viewShot("queue", "Queue", below(".podcast-view .pn-queue"));
	await show({ kind: "library" }, true);
	await viewShot(
		"player",
		"The method of loci in practice",
		below("section.pn-player .pn-switch"),
	);

	// The wide full player, with its panels as tabs.
	await place("pane");
	await hiDpi();
	await show({ kind: "library" }, true);
	await press("Transcript");
	await viewShot("transcript", "and he will only give you one of them.");

	// The note beside the player, in a desktop window.
	await desktop(HERO);
	await show({ kind: "library" }, true);
	await press("Transcript");
	await openFile(heroNote);
	await showProperties(true);
	await scrollNote("");
	await capture("episode-note", noteCrop(TITLE, CALLOUT), { css: HIDE_ID_PROPERTIES });
	// The hero folds the properties away so the captured timestamps sit mid-window.
	await showProperties(false);
	// The vault switcher shows the test vault's name.
	await capture("hero", VIEWPORT, {
		css: ".workspace-sidedock-vault-profile { visibility: hidden; }",
	});
	await sharp(path.join(work, "hero-light.png"))
		.resize(1200, 630, { fit: "cover", position: "top" })
		.png({ compressionLevel: 9, palette: true })
		.toFile(path.join(outDir, "og.png"));
	await scrollNote("## Notes");
	await capture("timestamps", noteCrop(NOTES_HEADING, LAST_LINE));
	await scrollNote("");
	// The table's columns need the width of both sidebars.
	await evaluate("app.workspace.rightSplit.collapse(); return true;");
	await openFile("PodNotes/Episodes.base");
	await sleep(1500);
	await capture("bases", BASES_TABLE);
	await evaluate("app.workspace.rightSplit.expand(); return true;");

	await desktop(DEMO);
	await show({ kind: "library" }, true);
	await openFile(heroNote);
	for (const name of THEMES) await recordDemo(heroNote, name);
	await playback(hero.playAt);

	// Obsidian's phone layout.
	await place("phone");
	await hiDpi();
	await openFile(heroNote);
	await showProperties(true);
	await scrollNote("");
	await capture("episode-note-phone", noteCrop(TITLE, CALLOUT), { css: HIDE_ID_PROPERTIES });
	await showProperties(false);
	await capture("hero-phone", noteCrop(TITLE, LAST_TIMESTAMP));
	await scrollNote("## Notes");
	await capture("timestamps-phone", noteCrop(NOTES_HEADING, LAST_LINE));
	await cursorAfterLastTimestamp();
	await scrollNote("## Notes");
	await sleep(1500);
	// The toolbar shows only while the editor has focus.
	await capture(
		"mobile-toolbar",
		`() => {
			const lines = [...app.workspace.getLeavesOfType("markdown")[0].view.contentEl.querySelectorAll(".cm-line")];
			const top = lines.find((el) => el.textContent.trim() === "Notes").getBoundingClientRect().top - 16;
			return { x: 0, y: top, width: innerWidth, height: innerHeight - top };
		}`,
		{
			css: ".cm-cursorLayer { display: none; } .cm-content { caret-color: transparent !important; }",
			focus: true,
		},
	);
	await openFile("PodNotes/Episodes.base");
	await sleep(1500);
	await capture("bases-phone", BASES_TABLE);
	// Show player's path on a phone: the view in the right sidebar's drawer.
	await evaluate(`
		app.workspace.detachLeavesOfType("podcast_player_view");
		await app.plugins.plugins.podnotes.showPlayer();
		return true;
	`);
	await waitFor(
		`return document.querySelector(".workspace-drawer.mod-right section.pn-player")?.getBoundingClientRect().width > 0;`,
		"The full player did not open in the right drawer",
	);
	await capture("mobile-player", DRAWER_PLAYER);
	await press("Transcript");
	await capture("transcript-phone", DRAWER_PLAYER);

	// A new install: the empty library.
	await seed("empty");
	await place("sidebar");
	await hiDpi();
	await show({ kind: "library" });
	await viewShot("add-podcast", "Add your first podcast");
	await theme("light");
	await cdp("Emulation.clearDeviceMetricsOverride");
	console.log(`Wrote the screenshots to ${path.relative(root, outDir)}`);
}

await main();
