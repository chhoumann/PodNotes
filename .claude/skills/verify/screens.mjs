#!/usr/bin/env node
// Pixel captures of the PodNotes view in this worktree's Obsidian instance, at
// the v3 design's three widths and in both themes, beside the design prototype.
//
//   node .claude/skills/verify/screens.mjs place <sidebar|pane|phone>
//   node .claude/skills/verify/screens.mjs theme <light|dark>
//   node .claude/skills/verify/screens.mjs seed <empty|library|episodes>
//   node .claude/skills/verify/screens.mjs go '<page JSON>'     e.g. '{"kind":"feed","key":"Field Notes"}'
//   node .claude/skills/verify/screens.mjs shot <file.png>
//   node .claude/skills/verify/screens.mjs set <state|all> <label> [--widths sidebar,pane,phone] [--themes light,dark]
//
// place  sidebar: the view in the right sidebar, 320 x 720. pane: the view in the
//        main area, 820 x 680, both sidebars collapsed. phone: mobile emulation on a
//        390 x 844 screen, the view in the main area. Fails unless the view measures
//        exactly that. Any other place leaves the phone for the desktop.
// seed   empty is a first run. library has the fixture library's eight podcasts (one
//        feed answers 404), a queue of four, a playlist and some played episodes;
//        episodes is the same vault. It rewrites data.json while PodNotes is
//        disabled and clears its feed cache, as a user would have it after earlier use.
// shot   waits until the view stops changing, moves the mouse off the window, blurs
//        focus, removes tooltips and notices (printing what the notices said), then
//        captures the view, or the whole screen on a phone.
// set    seeds the state's scene and, at each width and theme, opens its page and
//        shoots .obsidian-e2e-artifacts/screens/<label>/<state>-<width>-<theme>.png.
//        Then <state>-sheet.png has a row per width: light, then dark, each shot
//        followed by the prototype's screen when the design folder has one.
//        States: first-run, add-podcast, library, episodes, error-feed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	cliSocketExists,
	execObsidian,
	loadRunnerConfig,
	obsidianCommandArgs,
	resolveInstanceOptions,
	resolveProvisionOptions,
} from "obsidian-e2e/runner";
import { FIXTURE_HOST } from "../../../scripts/e2e-instance.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const config = await loadRunnerConfig(root);
const provision = resolveProvisionOptions({}, config, root);
const instance = resolveInstanceOptions(provision, {}, config, root);
const DATA_PATH = path.join(provision.vaultPath, ".obsidian/plugins/podnotes/data.json");
const UI = fileURLToPath(new URL("ui.mjs", import.meta.url));
const FIXTURES = fileURLToPath(new URL("fixtures.mjs", import.meta.url));
const OUT = path.join(root, ".obsidian-e2e-artifacts/screens");
const DESIGN = path.join(os.homedir(), ".claude/orchestrate/podnotes/design/screens");
const VIEW_TYPE = "podcast_player_view";
const CALL_TIMEOUT_MS = 15000;
/** @type {Record<string, [number, number]>} */
const WIDTHS = { sidebar: [320, 720], pane: [820, 680], phone: [390, 844] };
/** @type {Record<string, string>} */
const THEMES = { light: "moonstone", dark: "obsidian" };
const SCENES = ["empty", "library", "episodes"];

/**
 * @typedef {{ title: string, podcastName: string, duration: number }} Episode
 * @typedef {{ feed: { title: string }, missing: boolean, episodes: Episode[] }} LibraryFeed
 * @typedef {{ feeds: LibraryFeed[], add: { title: string, url: string } }} Library
 * @typedef {{ kind: string, key?: string }} Page
 */

/** @type {Record<string, { scene: string, page: (library: Library) => Page, text?: (library: Library) => string, paste?: boolean }>} */
const STATES = {
	"first-run": { scene: "empty", page: () => ({ kind: "library" }) },
	"add-podcast": {
		scene: "library",
		page: () => ({ kind: "add" }),
		text: (library) => library.add.title,
		paste: true,
	},
	library: { scene: "library", page: () => ({ kind: "library" }) },
	episodes: {
		scene: "episodes",
		page: (library) => ({ kind: "feed", key: longestTitle(library).podcastName }),
		text: (library) => longestTitle(library).title.slice(0, 40),
	},
	"error-feed": {
		scene: "library",
		page: (library) => ({ kind: "feed", key: missingFeed(library).feed.title }),
	},
};

// What a listener of the fixture library did with it, as in the design prototype.
// Episodes are named by podcast and the start of their title.
/** @type {[string, string][]} */
const QUEUE = [
	["Slow Thinking", "The case for boredom"],
	["Lunch Break History", "Who invented the index?"],
	["Signal & Noise", "Ep. 88"],
	["Night Owl Science", "Sleep, memory"],
];
const PLAYLIST = {
	name: "Commute",
	/** @type {[string, string][]} */
	episodes: [
		["Lunch Break History", "Who invented the index?"],
		["Making Sense of Markets", "Rates"],
		["Signal & Noise", "Ep. 87"],
		["Slow Thinking", "Walking"],
		["Small Rooms", "A desk"],
		["Lunch Break History", "Medieval"],
	],
};
/** @type {[[string, string], number | "finished"][]} */
const PLAYED = [
	[["Field Notes", "#213"], 2294],
	[["Field Notes", "#212"], "finished"],
	[["Field Notes", "#210"], "finished"],
	[["Field Notes", "#209"], 760],
	[["Field Notes", "#208"], "finished"],
	[["Field Notes", "#206"], "finished"],
	[["Signal & Noise", "Ep. 88"], 760],
	[["Night Owl Science", "Sleep, memory"], 600],
];

/** @param {string[]} args */
async function obsidian(args) {
	if (!(await cliSocketExists(instance))) {
		throw new Error(
			"This worktree's Obsidian instance is not running: npm run start:e2e-obsidian",
		);
	}
	const started = Date.now();
	const { stdout } = await execObsidian(
		instance,
		obsidianCommandArgs(instance.vaultName, args),
		{},
		{ timeout: CALL_TIMEOUT_MS },
	);
	// The CLI exits 0 with no output when the timeout kills it, so only the clock tells.
	if (Date.now() - started >= CALL_TIMEOUT_MS) {
		throw new Error(`obsidian ${args[0]} did not answer within ${CALL_TIMEOUT_MS} ms.`);
	}
	return stdout.trim();
}

/** @param {string} body */
async function evaluate(body) {
	const output = await obsidian([
		"eval",
		`code=(async () => JSON.stringify((await (async () => {${body}})()) ?? null))()`,
	]);
	if (!output.startsWith("=> ")) throw new Error(output || "eval printed nothing");
	return JSON.parse(output.slice(3));
}

/** @param {string} method @param {object} [params] */
async function cdp(method, params = {}) {
	const output = await obsidian([
		"dev:cdp",
		`method=${method}`,
		`params=${JSON.stringify(params)}`,
	]);
	if (!output.startsWith("{")) throw new Error(`${method}: ${output}`);
	return JSON.parse(output);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errors count as false, because the window reloads under some of these waits.
 * @param {string} body @param {string} what @param {number} [timeoutMs]
 */
async function waitFor(body, what, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	for (;;) {
		try {
			if ((await evaluate(body)) === true) return;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		if (Date.now() > deadline) throw new Error(`${what} after ${timeoutMs} ms. ${last}`);
		await sleep(250);
	}
}

/** @param {boolean} on */
async function setMobile(on) {
	const { mobile, origin } = await evaluate(
		"return { mobile: app.isMobile, origin: performance.timeOrigin };",
	);
	if (mobile === on) return;
	await evaluate(`setTimeout(() => app.emulateMobile(${on}), 50); return true;`);
	await waitFor(
		`return performance.timeOrigin !== ${origin} && app.isMobile === ${on} &&
			app.workspace.layoutReady && Boolean(app.plugins.plugins.podnotes);`,
		`Obsidian did not reload ${on ? "into" : "out of"} mobile emulation`,
	);
}

/** @param {string} name */
async function place(name) {
	if (!(name in WIDTHS)) throw new Error("Usage: place <sidebar|pane|phone>");
	const [width, height] = WIDTHS[name];
	const sidebar = name === "sidebar";
	const phone = name === "phone";
	if (phone) {
		await cdp("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: true,
			screenWidth: width,
			screenHeight: height,
		});
	} else {
		await cdp("Emulation.clearDeviceMetricsOverride");
	}
	await setMobile(phone);
	await evaluate(`
		const { workspace } = app;
		const inSidebar = (leaf) => leaf.getRoot() === workspace.rightSplit;
		for (const leaf of workspace.getLeavesOfType("${VIEW_TYPE}")) {
			if (inSidebar(leaf) !== ${sidebar}) leaf.detach();
		}
		if (workspace.getLeavesOfType("${VIEW_TYPE}").length === 0) {
			// Not getLeaf(false): it can return the leaf just detached when that leaf had focus.
			let leaf = ${sidebar} ? workspace.getRightLeaf(false) : undefined;
			workspace.iterateRootLeaves((candidate) => {
				if (!${sidebar} && (!leaf || candidate.view.getViewType() === "empty")) leaf = candidate;
			});
			await leaf.setViewState({ type: "${VIEW_TYPE}" });
		}
		// Show player's path: it reveals the leaf, and on mobile mounts the view.
		await app.plugins.plugins.podnotes.activateView();
		workspace.leftSplit.collapse();
		if (!${sidebar}) workspace.rightSplit.collapse();
		return true;
	`);
	const measure = async () => {
		await waitFor(
			`return document.querySelector(".podcast-view")?.getBoundingClientRect().width > 0;`,
			"The PodNotes view did not appear",
			10000,
		);
		return evaluate(`
			await new Promise((resolve) => setTimeout(resolve, 300));
			const rect = document.querySelector(".podcast-view").getBoundingClientRect();
			return { width: rect.width, height: ${phone} ? innerHeight : rect.height,
				phone: document.body.classList.contains("is-phone") };
		`);
	};
	// Obsidian's chrome can leave the view a fraction of a pixel taller; a capture rounds it.
	const fits = (/** @type {{ width: number, height: number }} */ view) =>
		view.width === width && Math.round(view.height) === height;
	let measured = await measure();
	for (let attempt = 0; !phone && attempt < 3; attempt++) {
		if (fits(measured)) break;
		await evaluate(`
			const win = require("electron").remote.getCurrentWindow();
			if (win.isFullScreen()) win.setFullScreen(false);
			if (win.isMaximized()) win.unmaximize();
			const [contentWidth, contentHeight] = win.getContentSize();
			const dw = ${width} - ${measured.width};
			const dh = ${height} - ${measured.height};
			if (${sidebar}) app.workspace.rightSplit.setSize(app.workspace.rightSplit.size + dw);
			win.setContentSize(
				${sidebar} ? Math.max(contentWidth, 1024) : Math.round(contentWidth + dw),
				Math.round(contentHeight + dh),
			);
			return true;
		`);
		measured = await measure();
	}
	const problems = [
		measured.width !== width && `the view is ${measured.width} px wide, not ${width}`,
		Math.round(measured.height) !== height &&
			`${phone ? "the screen" : "the view"} is ${measured.height} px tall, not ${height}`,
		phone !== measured.phone && `body.is-phone is ${measured.phone}`,
	].filter(Boolean);
	if (problems.length > 0) throw new Error(`place ${name}: ${problems.join("; ")}.`);
	console.log(JSON.stringify({ place: name, width: measured.width, height: measured.height }));
}

/** @param {string} name */
async function theme(name) {
	if (!(name in THEMES)) throw new Error("Usage: theme <light|dark>");
	await evaluate(`app.changeTheme("${THEMES[name]}"); return true;`);
	await waitFor(
		`return document.body.classList.contains("theme-${name}");`,
		`The ${name} theme did not apply`,
		5000,
	);
}

/** @returns {Promise<Library>} */
async function library() {
	const url = execFileSync(process.execPath, [FIXTURES, "library"], { encoding: "utf8" }).trim();
	const response = await fetch(url.replace(`//${FIXTURE_HOST}:`, "//127.0.0.1:"));
	if (!response.ok) {
		throw new Error(
			`${url} answered ${response.status}. Restart the fixture server: node .claude/skills/verify/fixtures.mjs stop`,
		);
	}
	return response.json();
}

/** @param {Library} lib */
function longestTitle(lib) {
	return lib.feeds
		.flatMap((feed) => feed.episodes)
		.reduce((longest, episode) =>
			episode.title.length > longest.title.length ? episode : longest,
		);
}

/** @param {Library} lib */
function missingFeed(lib) {
	const feed = lib.feeds.find((candidate) => candidate.missing);
	if (!feed) throw new Error("The fixture library has no feed that answers 404.");
	return feed;
}

/** @param {Library} lib @param {[string, string]} reference */
function episode(lib, [podcast, title]) {
	const found = lib.feeds
		.find((feed) => feed.feed.title === podcast)
		?.episodes.find((candidate) => candidate.title.startsWith(title));
	if (!found) throw new Error(`The fixture library has no episode "${title}" in ${podcast}.`);
	return found;
}

/** @param {Library} lib */
function libraryData(lib) {
	return {
		savedFeeds: Object.fromEntries(lib.feeds.map(({ feed }) => [feed.title, feed])),
		queue: {
			episodes: QUEUE.map((reference) => episode(lib, reference)),
		},
		playlists: {
			[PLAYLIST.name]: {
				icon: "list-music",
				name: PLAYLIST.name,
				shouldEpisodeRemoveAfterPlay: false,
				shouldRepeat: false,
				episodes: PLAYLIST.episodes.map((reference) => episode(lib, reference)),
			},
		},
		playedEpisodes: Object.fromEntries(
			PLAYED.map(([reference, time]) => {
				const { title, podcastName, duration } = episode(lib, reference);
				const finished = time === "finished";
				return [
					`${podcastName}::${title}`,
					{ title, podcastName, time: finished ? duration : time, duration, finished },
				];
			}),
		),
	};
}

/** @param {string} scene */
async function seed(scene) {
	if (!SCENES.includes(scene)) throw new Error(`Usage: seed <${SCENES.join("|")}>`);
	/** @type {Record<string, any>} */
	const data = structuredClone(/** @type {Record<string, any>} */ (config.defaultData));
	if (scene !== "empty") {
		const { queue, ...rest } = libraryData(await library());
		Object.assign(data, rest, { queue: { ...data.queue, ...queue } });
	}
	await evaluate(`
		await app.plugins.disablePlugin("podnotes");
		for (const key of Object.keys(localStorage)) {
			if (key.includes("podnotes:feed-cache")) localStorage.removeItem(key);
		}
		return true;
	`);
	fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, "\t")}\n`);
	await evaluate(`await app.plugins.enablePlugin("podnotes"); return true;`);
	await waitFor(
		"return Boolean(app.plugins.plugins.podnotes?.navigation);",
		"PodNotes did not load",
		10000,
	);
}

/** @param {Page} page */
async function go(page) {
	await evaluate(`
		const plugin = app.plugins.plugins.podnotes;
		plugin.navigation.replace(${JSON.stringify(page)});
		await plugin.activateView();
		return true;
	`);
}

/** @param {string} [text] */
async function settle(text = "") {
	const deadline = Date.now() + 20000;
	let previous = "";
	let stable = 0;
	for (;;) {
		const state = await evaluate(`
			const view = document.querySelector(".podcast-view");
			if (!view) return { why: "no .podcast-view" };
			const box = view.getBoundingClientRect();
			const loading = [...view.querySelectorAll("img")].filter((img) => {
				const rect = img.getBoundingClientRect();
				const visible = rect.bottom > box.top && rect.top < box.bottom && rect.width > 0;
				return visible && !img.complete;
			}).length;
			const moving = document.getAnimations().filter(
				(animation) => animation.playState === "running" && view.contains(animation.effect?.target),
			).length;
			const shown = view.innerText.includes(${JSON.stringify(text)});
			return { loading, moving, shown, markup: view.innerHTML.length };
		`);
		const ready = state.loading === 0 && state.moving === 0 && state.shown;
		const markup = String(state.markup);
		stable = ready && markup === previous ? stable + 1 : 0;
		previous = markup;
		if (stable >= 3) return;
		if (Date.now() > deadline) {
			throw new Error(`The view did not settle within 20 s: ${JSON.stringify(state)}`);
		}
		await sleep(250);
	}
}

/** @param {string} file @param {string} [text] */
async function shot(file, text) {
	await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: -10, y: -10 });
	await evaluate(`
		document.activeElement?.blur?.();
		document.querySelectorAll(".tooltip").forEach((tooltip) => tooltip.remove());
		return true;
	`);
	await settle(text);
	const target = await evaluate(`
		document.querySelectorAll(".tooltip").forEach((tooltip) => tooltip.remove());
		const notices = [...document.querySelectorAll(".notice")].map((notice) => {
			const said = notice.innerText.trim();
			notice.remove();
			return said;
		});
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const rect = document.body.classList.contains("is-phone")
			? { x: 0, y: 0, width: innerWidth, height: innerHeight }
			: document.querySelector(".podcast-view").getBoundingClientRect().toJSON();
		return { notices, rect, scale: devicePixelRatio };
	`);
	// Whole pixels, so the capture is not resampled.
	const [x, y, width, height] = ["x", "y", "width", "height"].map((key) =>
		Math.round(target.rect[key]),
	);
	const { data } = await cdp("Page.captureScreenshot", {
		format: "png",
		clip: { x, y, width, height, scale: 1 },
	});
	const png = Buffer.from(data, "base64");
	const size = pngSize(png);
	if (size.width !== width * target.scale || size.height !== height * target.scale) {
		throw new Error(
			`The capture is ${size.width} x ${size.height}, not the ${width} x ${height} view.`,
		);
	}
	fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
	fs.writeFileSync(file, png);
	console.log(
		JSON.stringify({
			file: path.relative(root, path.resolve(file)),
			...size,
			notices: target.notices,
		}),
	);
}

/** @param {Buffer} png */
function pngSize(png) {
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** @param {{ file: string, caption: string }[][]} rows @param {string} out */
function contactSheet(rows, out) {
	const GAP = 16;
	const CAPTION = 28;
	const cells = [];
	const layout = [];
	let y = GAP;
	for (const row of rows) {
		let x = GAP;
		let tallest = 0;
		for (const cell of row) {
			const size = pngSize(fs.readFileSync(cell.file));
			cells.push(cell);
			layout.push(`${x}_${y}`);
			x += size.width + GAP;
			tallest = Math.max(tallest, size.height + CAPTION);
		}
		y += tallest + GAP;
	}
	const labelled = cells.map(
		(cell, i) =>
			`[${i}:v]format=rgb24,pad=iw:ih+${CAPTION}:0:${CAPTION}:color=0x5c5c5c,` +
			`drawtext=font=Sans:fontsize=15:fontcolor=white:x=2:y=7:text='${cell.caption}'[c${i}]`,
	);
	const stacked =
		cells.length === 1
			? "[c0]null"
			: `${cells.map((_, i) => `[c${i}]`).join("")}xstack=inputs=${cells.length}:layout=${layout.join("|")}:fill=0x5c5c5c`;
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-y",
			...cells.flatMap((cell) => ["-i", cell.file]),
			"-filter_complex",
			`${labelled.join(";")};${stacked},pad=iw+${GAP}:ih+${GAP}:0:0:color=0x5c5c5c[out]`,
			"-map",
			"[out]",
			"-frames:v",
			"1",
			out,
		],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
}

/** @param {string} state @param {string} label @param {string[]} widths @param {string[]} themes */
async function set(state, label, widths, themes) {
	const recipe = STATES[state];
	if (!recipe)
		throw new Error(`Unknown state ${state}; use all or ${Object.keys(STATES).join(", ")}.`);
	const lib = await library();
	const dir = path.join(OUT, label);
	await seed(recipe.scene);
	/** @type {{ file: string, caption: string }[][]} */
	const rows = [];
	for (const width of widths) {
		await place(width);
		const row = [];
		for (const name of themes) {
			await theme(name);
			await go(recipe.page(lib));
			if (recipe.paste) {
				execFileSync(
					process.execPath,
					[UI, "fill", '.podcast-view input[placeholder^="Search"]', lib.add.url],
					{ stdio: "inherit" },
				);
			}
			const file = path.join(dir, `${state}-${width}-${name}.png`);
			await shot(file, recipe.text?.(lib));
			row.push({ file, caption: `${width} ${name} ${label}` });
			const prototype = path.join(DESIGN, `${state}-${width}-${name}.png`);
			if (fs.existsSync(prototype))
				row.push({ file: prototype, caption: `${width} ${name} prototype` });
		}
		rows.push(row);
	}
	const sheet = path.join(dir, `${state}-sheet.png`);
	contactSheet(rows, sheet);
	console.log(JSON.stringify({ sheet: path.relative(root, sheet) }));
}

/** @param {string[]} args @param {string} name @param {string[]} fallback */
function list(args, name, fallback) {
	const index = args.indexOf(name);
	return index === -1 ? fallback : args[index + 1].split(",");
}

const [verb, target, ...rest] = process.argv.slice(2);
try {
	if (verb === "place" && target) await place(target);
	else if (verb === "theme" && target) await theme(target);
	else if (verb === "seed" && target) await seed(target);
	else if (verb === "go" && target) await go(JSON.parse(target));
	else if (verb === "shot" && target) await shot(target);
	else if (verb === "set" && target && rest[0] && /^[\w.-]+$/.test(rest[0])) {
		const widths = list(rest, "--widths", Object.keys(WIDTHS));
		const themes = list(rest, "--themes", Object.keys(THEMES));
		const unknown = [
			...widths.filter((name) => !(name in WIDTHS)),
			...themes.filter((name) => !(name in THEMES)),
		];
		if (unknown.length > 0) throw new Error(`Unknown width or theme: ${unknown.join(", ")}.`);
		for (const state of target === "all" ? Object.keys(STATES) : [target]) {
			await set(state, rest[0], widths, themes);
		}
	} else {
		throw new Error(
			"Usage: screens.mjs place|theme|seed|go|shot|set ... (see the header of this file)",
		);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
