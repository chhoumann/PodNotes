#!/usr/bin/env node
// Pixel captures of the PodNotes view in this worktree's Obsidian instance, at
// the v3 design's three widths and in both themes, beside the design prototype.
//
//   node .claude/skills/verify/screens.mjs place <sidebar|pane|phone>
//   node .claude/skills/verify/screens.mjs theme <light|dark>
//   node .claude/skills/verify/screens.mjs seed <empty|library|episodes|lists|local|offline>
//   node .claude/skills/verify/screens.mjs go '<page JSON>'     e.g. '{"kind":"feed","key":"Field Notes"}'
//   node .claude/skills/verify/screens.mjs offline <on|off>
//   node .claude/skills/verify/screens.mjs shot <file.png>
//   node .claude/skills/verify/screens.mjs set <state|player|all> <label> [--widths sidebar,pane,phone] [--themes light,dark]
//
// place   sidebar: the view in the right sidebar, 320 x 720. pane: the view in the
//         main area, 820 x 680, both sidebars collapsed. phone: mobile emulation on a
//         390 x 844 screen, the view in the main area. Fails unless the view measures
//         exactly that. Any other place leaves the phone for the desktop.
// seed    empty is a first run. library has the fixture library's eight podcasts (one
//         feed answers 404), a queue of four, a playlist and some played episodes;
//         episodes is the same vault. lists adds Favorites, three more playlists, a
//         1.25x speed and a loaded, paused episode. local adds four media files in vault
//         folders, registered as local files; offline adds four downloaded episodes
//         instead. It rewrites data.json while PodNotes is disabled, deletes the episode
//         notes under PodNotes/ and clears its feed cache, as a user would have it after
//         earlier use.
// offline on: the renderer goes offline through CDP, so navigator.onLine is false
//         and the window fires `offline`, and the fixture server stops, so feed
//         requests fail too: Obsidian sends them from its main process, which CDP
//         does not reach. off undoes both. Each fails unless all of that holds.
// shot    waits until the view stops changing, moves the mouse off the window, blurs
//         focus, removes tooltips and notices (printing what the notices said), hides
//         Obsidian's status bar, then captures the view, or the whole screen on a phone.
// set     seeds the state's scene and, at each width and theme, opens its page and
//         shoots .obsidian-e2e-artifacts/screens/<label>/<state>-<width>-<theme>.png.
//         Then <state>-sheet.png has a row per width: light, then dark, each shot
//         followed by the prototype's screen when the design folder has one.
//         States: first-run, add-podcast, library, episodes, error-feed, queue,
//         playlists, playlist, latest, played, local-files, offline, status-bar, and the
//         player's: now-playing, mini-player, capture, chapters, up-next, up-next-empty,
//         no-chapters, video, local-player, media-error. player runs the player's states
//         and all runs every state; both go on past a failed state and fail at the end.
//         status-bar is the queue with the mini player and a "9 properties" item in
//         Obsidian's status bar, which that state's shots keep. It has no phone shot:
//         Obsidian hides the status bar on mobile.
//         A player state plays the scene's current episode until its media loads, then
//         pauses it at a fixed second, and opens the full player over the Library;
//         mini-player stays on the podcast's page. media-error waits for the load to
//         fail instead. capture, chapters, up-next and up-next-empty then press the full
//         player's Timestamp, Chapters or Up next button with real input, so they fail
//         at once on a full player without a button that reads exactly that.
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
const CURRENT_THEME = `(document.body.classList.contains("theme-dark") ? "dark" : "light")`;

/**
 * @typedef {{ title: string, podcastName: string, duration: number, episodeDate: string }} Episode
 * @typedef {{ feed: { title: string }, missing: boolean, episodes: Episode[] }} LibraryFeed
 * @typedef {{ feeds: LibraryFeed[], add: { title: string, url: string } }} Library
 * @typedef {{ kind: string, key?: string, name?: string }} Page
 * @typedef {Record<string, any>} Data
 * @typedef {(data: Data, library: Library) => void | Promise<void>} Ingredient
 */

/**
 * @typedef {object} Recipe
 * @property {string} scene
 * @property {Ingredient} [extra] Applied after the scene's ingredients.
 * @property {(library: Library) => Page} page
 * @property {(library: Library) => string} [text] Text the view shows once it is ready.
 * @property {boolean} [paste]
 * @property {boolean} [offline]
 * @property {boolean} [statusBar]
 * @property {boolean} [open] Opens the full player.
 * @property {number | "error"} [play] The second the current episode pauses at, or "error"
 *   when its media fails to load.
 * @property {boolean} [note] The episode note already holds a capture.
 * @property {string} [press] The full player's button to press, by its text.
 */

/** The episode the listener is in the middle of, as in the prototype. @type {[string, string]} */
const NOW_PLAYING = ["Field Notes", "#213"];
const NOW_PLAYING_AT = 2294;
/** @type {[string, string]} */
const NO_CHAPTERS = ["Signal & Noise", "Ep. 87"];
/** @type {[string, string]} */
const VIDEO = ["Signal & Noise", "Ep. 86"];
/** @type {[string, string]} */
const BROKEN_MEDIA = ["Signal & Noise", "Ep. 85"];
/** @type {Recipe} */
const FULL_PLAYER = {
	scene: "lists",
	page: () => ({ kind: "library" }),
	open: true,
	play: NOW_PLAYING_AT,
};

/** @type {Record<string, Recipe>} */
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
	queue: { scene: "lists", page: () => ({ kind: "queue" }), text: () => QUEUE[0][1] },
	playlists: {
		scene: "lists",
		page: () => ({ kind: "playlists" }),
		text: () => PLAYLISTS[PLAYLISTS.length - 1].name,
	},
	playlist: {
		scene: "lists",
		page: () => ({ kind: "playlist", name: PLAYLIST.name }),
		text: () => PLAYLIST.episodes[0][1],
	},
	latest: { scene: "lists", page: () => ({ kind: "latest" }), text: newestTitle },
	played: { scene: "lists", page: () => ({ kind: "played" }), text: () => PLAYED[1][0][1] },
	"local-files": {
		scene: "local",
		page: () => ({ kind: "local" }),
		text: () => path.parse(LOCAL_FILES[0][0]).name,
	},
	offline: {
		scene: "offline",
		page: () => ({ kind: "latest" }),
		text: newestTitle,
		offline: true,
	},
	"status-bar": {
		scene: "lists",
		page: () => ({ kind: "queue" }),
		text: () => QUEUE[0][1],
		statusBar: true,
	},
	// The chapters load after the player opens. This one is #213's at NOW_PLAYING_AT.
	"now-playing": { ...FULL_PLAYER, text: () => "The method of loci in practice" },
	"mini-player": {
		scene: "lists",
		page: (library) => ({ kind: "feed", key: episode(library, NOW_PLAYING).podcastName }),
		play: NOW_PLAYING_AT,
		text: (library) => episode(library, NOW_PLAYING).title.slice(0, 40),
	},
	// The capture toast, which has to outlast the shot.
	capture: { ...FULL_PLAYER, note: true, press: "Timestamp", text: () => "Timestamp added" },
	// #213's last chapter.
	chapters: { ...FULL_PLAYER, press: "Chapters", text: () => "Listener question" },
	"up-next": { ...FULL_PLAYER, press: "Up next", text: () => QUEUE[0][1] },
	"up-next-empty": {
		...FULL_PLAYER,
		extra: (data) => {
			data.queue.episodes = [];
		},
		press: "Up next",
	},
	"no-chapters": {
		...FULL_PLAYER,
		extra: (data, library) => {
			data.currentEpisode = episode(library, NO_CHAPTERS);
		},
		play: 1140,
		text: () => NO_CHAPTERS[1],
	},
	video: {
		...FULL_PLAYER,
		extra: (data, library) => {
			data.currentEpisode = episode(library, VIDEO);
			data.queue.episodes = latest(library).slice(0, 14);
		},
		play: 4,
		text: () => VIDEO[1],
	},
	"local-player": {
		...FULL_PLAYER,
		scene: "local",
		extra: (data) => {
			data.currentEpisode = data.downloadedEpisodes["local file"].find(
				(/** @type {{ filePath: string }} */ file) => file.filePath === LOCAL_FILES[0][0],
			);
		},
		play: 1283,
		text: () => path.parse(LOCAL_FILES[0][0]).name,
	},
	"media-error": {
		...FULL_PLAYER,
		extra: (data, library) => {
			data.currentEpisode = episode(library, BROKEN_MEDIA);
		},
		play: "error",
		text: () => BROKEN_MEDIA[1],
	},
};
const STATUS_ITEM = "podnotes-verify-status-item";

// What a listener of the fixture library did with it, as in the design prototype.
// Episodes are named by the start of their podcast's title and of their own.
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
	[NOW_PLAYING, NOW_PLAYING_AT],
	[["Field Notes", "#212"], "finished"],
	[["Field Notes", "#210"], "finished"],
	[["Field Notes", "#209"], 760],
	[["Field Notes", "#208"], "finished"],
	[["Field Notes", "#206"], "finished"],
	[["Signal & Noise", "Ep. 88"], 760],
	[["Night Owl Science", "Sleep, memory"], 600],
];
/** @type {[string, string][]} */
const FAVORITES = [
	["Field Notes", "#212"],
	["The Archive Hour", "Luhmann"],
	["Slow Thinking", "Attention"],
	["Lunch Break History", "The library of Alexandria"],
	["Field Notes", "#208"],
];
const PLAYLISTS = [
	{
		name: "Memory research",
		/** @type {[string, string][]} */
		episodes: [
			["Field Notes", "#213"],
			["Night Owl Science", "Sleep, memory"],
			["The Archive Hour", "Commonplace books"],
			["Field Notes", "#209"],
		],
	},
	{
		name: "Long walks, slow ideas",
		/** @type {[string, string][]} */
		episodes: [
			["Slow Thinking", "Walking"],
			["Field Notes", "#211"],
			["The Archive Hour", "Luhmann"],
		],
	},
];
/** @type {[string, string][]} */
const DOWNLOADS = [
	["Field Notes", "#213"],
	["Field Notes", "#211"],
	["Slow Thinking", "The case for boredom"],
	["Night Owl Science", "Sleep, memory"],
];
/** Vault media: path, length in seconds, and the played position. @type {[string, number, (number | "finished")?][]} */
const LOCAL_FILES = [
	["Recordings/Family/Interview with grandma.m4a", 3850],
	["University/Psychology/Lecture 07 - Cognitive load theory.mp4", 2913, 1032],
	["Inbox/Voice memo 2026-09-14.webm", 221],
	["Recordings/Book club/Book club - The Overstory, chapters 1-4.mp3", 5460, "finished"],
];
/** Silent media small enough for a vault, by container. @type {Record<string, string[]>} */
const ENCODERS = {
	".m4a": ["-c:a", "aac", "-b:a", "8k"],
	".mp4": ["-c:v", "libx264", "-crf", "51", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "8k"],
	".webm": ["-c:a", "libopus", "-b:a", "6k"],
	".mp3": ["-c:a", "libmp3lame", "-b:a", "8k"],
};

/** Each scene's ingredients, applied in order to the default data.json. @type {Record<string, Ingredient[]>} */
const SCENES = {
	empty: [],
	library: [libraryData],
	episodes: [libraryData],
	lists: [libraryData, listening],
	local: [libraryData, listening, localFiles],
	offline: [libraryData, listening, downloads],
};

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

/** What Latest episodes lists, newest first: Night Owl Science's feed answers 404. @param {Library} lib */
function latest(lib) {
	return lib.feeds
		.filter((feed) => !feed.missing)
		.flatMap((feed) => feed.episodes)
		.sort((a, b) => b.episodeDate.localeCompare(a.episodeDate));
}

/** @param {Library} lib */
function newestTitle(lib) {
	return latest(lib)[0].title;
}

/** @param {Library} lib @param {[string, string]} reference */
function episode(lib, [podcast, title]) {
	const found = lib.feeds
		.find((feed) => feed.feed.title.startsWith(podcast))
		?.episodes.find((candidate) => candidate.title.startsWith(title));
	if (!found) throw new Error(`The fixture library has no episode "${title}" in ${podcast}.`);
	return found;
}

/** @param {{ name: string, episodes: [string, string][] }} list @param {Library} lib */
function playlist({ name, episodes }, lib) {
	return {
		icon: "list-music",
		name,
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
		episodes: episodes.map((reference) => episode(lib, reference)),
	};
}

/**
 * The playedEpisodes entry PodNotes keeps for an episode.
 * @param {{ title: string, podcastName: string }} episode @param {number | "finished"} time @param {number} duration
 * @returns {[string, { title: string, podcastName: string, time: number, duration: number, finished: boolean }]}
 */
function playedRecord({ title, podcastName }, time, duration) {
	const finished = time === "finished";
	return [
		`${podcastName}::${title}`,
		{ title, podcastName, time: finished ? duration : time, duration, finished },
	];
}

/** @type {Ingredient} */
function libraryData(data, lib) {
	data.savedFeeds = Object.fromEntries(lib.feeds.map(({ feed }) => [feed.title, feed]));
	data.queue.episodes = QUEUE.map((reference) => episode(lib, reference));
	data.playlists = { [PLAYLIST.name]: playlist(PLAYLIST, lib) };
	data.playedEpisodes = Object.fromEntries(
		PLAYED.map(([reference, time]) => {
			const found = episode(lib, reference);
			return playedRecord(found, time, found.duration);
		}),
	);
}

/** Restored at startup, so the mini player shows it paused. @type {Ingredient} */
function listening(data, lib) {
	data.favorites.episodes = FAVORITES.map((reference) => episode(lib, reference));
	for (const list of PLAYLISTS) data.playlists[list.name] = playlist(list, lib);
	data.currentEpisode = episode(lib, NOW_PLAYING);
	data.defaultPlaybackRate = 1.25;
}

/** The entries src/playLocalFile.ts writes, for media written into the vault. @type {Ingredient} */
async function localFiles(data) {
	for (const [file, seconds] of LOCAL_FILES) {
		const target = path.join(provision.vaultPath, file);
		if (fs.existsSync(target)) continue;
		const video = path.extname(file) === ".mp4";
		const scratch = path.join(
			fs.mkdtempSync(path.join(os.tmpdir(), "podnotes-media-")),
			path.basename(file),
		);
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"anullsrc=r=8000:cl=mono",
			...(video ? ["-f", "lavfi", "-i", "color=c=0x334155:s=64x36:r=1"] : []),
			"-t",
			String(seconds),
			...ENCODERS[path.extname(file)],
			scratch,
		]);
		// Copied in whole, so Obsidian never indexes a file ffmpeg is still writing.
		fs.mkdirSync(path.dirname(target), { recursive: true });
		fs.copyFileSync(scratch, target);
		fs.rmSync(path.dirname(scratch), { recursive: true });
	}
	const sizes = Object.fromEntries(
		LOCAL_FILES.map(([file]) => [file, fs.statSync(path.join(provision.vaultPath, file)).size]),
	);
	await waitFor(
		`const sizes = ${JSON.stringify(sizes)};
		return Object.entries(sizes).every(([file, size]) => app.vault.getAbstractFileByPath(file)?.stat.size === size);`,
		"Obsidian did not index the local media files",
		10000,
	);
	/** @type {{ file: string, title: string, url: string, streamUrl: string, ctime: number }[]} */
	const files = await evaluate(`
		return ${JSON.stringify(Object.keys(sizes))}.map((file) => {
			const found = app.vault.getAbstractFileByPath(file);
			return { file, title: found.basename, url: app.fileManager.generateMarkdownLink(found, ""),
				streamUrl: app.vault.getResourcePath(found), ctime: found.stat.ctime };
		});
	`);
	data.downloadedEpisodes["local file"] = files.map(({ file, title, url, streamUrl, ctime }) => ({
		title,
		description: "",
		content: "",
		podcastName: "local file",
		url,
		streamUrl,
		filePath: file,
		episodeDate: new Date(ctime).toISOString(),
		mediaType: path.extname(file) === ".mp4" ? "video" : "audio",
		size: sizes[file],
	}));
	for (const [file, seconds, time] of LOCAL_FILES) {
		if (time === undefined) continue;
		const [key, record] = playedRecord(
			{ title: path.parse(file).name, podcastName: "local file" },
			time,
			seconds,
		);
		data.playedEpisodes[key] = record;
	}
}

/** Downloaded as PodNotes does, to its default download path; the fixture serves a WAV. @type {Ingredient} */
function downloads(data, lib) {
	for (const reference of DOWNLOADS) {
		const found = episode(lib, reference);
		const file = `PodNotes/${found.podcastName}/${found.title.replace(/[\\/:*?"<>|#^[\]]/g, "")}.wav`;
		const target = path.join(provision.vaultPath, file);
		if (!fs.existsSync(target)) execFileSync(process.execPath, [FIXTURES, "audio", file]);
		(data.downloadedEpisodes[found.podcastName] ??= []).push({
			...found,
			filePath: file,
			size: fs.statSync(target).size,
			downloadedByPodNotes: true,
		});
	}
}

/** @param {string} scene @param {Ingredient} [extra] */
async function seed(scene, extra) {
	const ingredients = SCENES[scene];
	if (!ingredients) throw new Error(`Usage: seed <${Object.keys(SCENES).join("|")}>`);
	/** @type {Data} */
	const data = structuredClone(/** @type {Data} */ (config.defaultData));
	const all = extra ? [...ingredients, extra] : ingredients;
	if (all.length > 0) {
		const lib = await library();
		for (const add of all) await add(data, lib);
	}
	await evaluate(`
		const plugin = app.plugins.plugins.podnotes;
		await app.plugins.disablePlugin("podnotes");
		// Unloading saves without waiting, and that save merges into the file written next.
		await plugin?.flushSaves();
		for (const key of Object.keys(localStorage)) {
			if (key.includes("podnotes:feed-cache")) localStorage.removeItem(key);
		}
		// A note left by an earlier capture shows as Open note and as a note mark in lists.
		for (const note of app.vault.getMarkdownFiles()) {
			if (note.path.startsWith("PodNotes/")) await app.vault.delete(note);
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

const PLAYER_STATE = `let state;
	app.plugins.plugins.podnotes.player.state.subscribe((value) => (state = value))();`;

/**
 * Plays the episode the scene restored and pauses it at `at` seconds once its media has
 * loaded, saved there so lists show the same progress every time. "error" waits for the
 * load to fail instead.
 * @param {number | "error"} at
 */
async function playback(at) {
	await evaluate(
		`${PLAYER_STATE} app.plugins.plugins.podnotes.player.play(state.episode); return true;`,
	);
	if (at === "error") {
		await waitFor(
			`${PLAYER_STATE} return state.status === "error";`,
			"The episode's media did not fail to load",
		);
		return;
	}
	await waitFor(
		`${PLAYER_STATE} return state.status === "playing";`,
		"The episode's media did not load and play",
	);
	await evaluate(`
		const { player } = app.plugins.plugins.podnotes;
		player.pause();
		player.seek(${at});
		return true;
	`);
	await waitFor(
		`const media = document.querySelector(".podnotes-media");
		return media.paused && !media.seeking && media.readyState >= 2 && media.currentTime === ${at};`,
		`The episode did not pause at ${at} s`,
	);
	await evaluate("app.plugins.plugins.podnotes.player.save(); return true;");
}

/** Captures once without the UI, so the episode note exists, as after an earlier capture. */
async function episodeNote() {
	const capture = await evaluate(`
		// The last note open in an editor would take the capture.
		app.workspace.detachLeavesOfType("markdown");
		return await app.plugins.plugins.podnotes.capture.timestamp();
	`);
	if (capture?.destination !== "note") {
		throw new Error(`The capture went to ${JSON.stringify(capture)}, not the episode note.`);
	}
}

/**
 * Presses the full player's button that reads `text`, with real input. A panel switch or
 * tab that is already on stays on. Fails at once without such a button.
 * @param {string} text
 */
async function press(text) {
	const button = `[...document.querySelectorAll("section.pn-player button")].find((button) =>
		button.getBoundingClientRect().width > 0 && button.innerText.trim() === ${JSON.stringify(text)})`;
	// "true" or "false" for a panel switch or tab.
	const state = `((button) => !button ? "missing" :
		button.getAttribute("aria-pressed") ?? button.getAttribute("aria-selected") ?? "action")(${button})`;
	const kind = await evaluate(`return ${state};`);
	if (kind === "missing") {
		throw new Error(`No button in the full player (section.pn-player) reads "${text}".`);
	}
	if (kind === "true") return;
	execFileSync(
		process.execPath,
		[UI, "click", "section.pn-player button", "--text", text, "--exact"],
		{ stdio: "inherit" },
	);
	if (kind === "false") {
		await waitFor(`return ${state} === "true";`, `"${text}" did not turn on`, 5000);
		return;
	}
	// Timestamp reads "Added" for 1.2 s after a capture.
	await sleep(1500);
	await waitFor(`return Boolean(${button});`, `"${text}" did not come back`, 5000);
}

/** @param {boolean} on */
async function offline(on) {
	execFileSync(process.execPath, [FIXTURES, on ? "stop" : "library"]);
	const event = on ? "offline" : "online";
	await evaluate(`
		window.__podnotesVerifyNetwork = navigator.onLine === ${on}
			? new Promise((resolve) => addEventListener("${event}", () => resolve("fired"), { once: true }))
			: Promise.resolve("was already ${event}");
		return true;
	`);
	await cdp("Network.emulateNetworkConditions", {
		offline: on,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	});
	const state = await evaluate(`
		const event = await Promise.race([
			window.__podnotesVerifyNetwork,
			new Promise((resolve) => setTimeout(() => resolve("did not fire"), 2000)),
		]);
		// The first saved feed, sent the way requestUrl sends PodNotes' feed requests.
		const url = Object.values(app.plugins.plugins.podnotes.settings.savedFeeds)[0]?.url;
		const ipc = window.electron.ipcRenderer;
		const reply = "podnotes-verify-" + Math.random();
		const feed = url === undefined ? "no saved feed" : await new Promise((resolve) => {
			ipc.once(reply, (_event, response) => resolve(response.error ? "failed" : response.status));
			ipc.send("request-url", reply, { url, method: "GET" });
			setTimeout(() => resolve("no answer"), 5000);
		});
		return { onLine: navigator.onLine, ${event}: event, feed };
	`);
	console.log(JSON.stringify(state));
	const feedAsExpected =
		state.feed === "no saved feed" || (typeof state.feed === "number") !== on;
	if (state.onLine === on || state[event] === "did not fire" || !feedAsExpected) {
		throw new Error(`offline ${on ? "on" : "off"} did not take: ${JSON.stringify(state)}`);
	}
}

/** Adds or removes an item in Obsidian's status bar, as a plugin's addStatusBarItem does. @param {boolean} on */
async function statusItem(on) {
	await evaluate(`
		document.querySelector(".${STATUS_ITEM}")?.remove();
		if (${on}) document.querySelector(".status-bar").createDiv({ cls: "status-bar-item ${STATUS_ITEM}", text: "9 properties" });
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

/**
 * `statusBar` keeps Obsidian's status bar in the capture, which then fails unless the
 * whole bar lies inside it.
 * @param {string} file @param {string} [text] @param {string} [themeName] @param {boolean} [statusBar]
 */
async function shot(file, text, themeName, statusBar = false) {
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
		// Obsidian's status bar floats over the view's bottom-right corner.
		const bar = document.querySelector(".status-bar");
		if (!${statusBar}) bar?.style.setProperty("visibility", "hidden");
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const rect = document.body.classList.contains("is-phone")
			? { x: 0, y: 0, width: innerWidth, height: innerHeight }
			: document.querySelector(".podcast-view").getBoundingClientRect().toJSON();
		return { notices, rect, bar: bar?.getBoundingClientRect().toJSON(), scale: devicePixelRatio, theme: ${CURRENT_THEME} };
	`);
	// Whole pixels, so the capture is not resampled.
	const [x, y, width, height] = ["x", "y", "width", "height"].map((key) =>
		Math.round(target.rect[key]),
	);
	const bar = target.bar;
	if (
		statusBar &&
		!(
			bar?.width > 0 &&
			Math.round(bar.left) >= x &&
			Math.round(bar.right) <= x + width &&
			Math.round(bar.top) >= y &&
			Math.round(bar.bottom) <= y + height
		)
	) {
		throw new Error(`Obsidian's status bar ${JSON.stringify(bar)} is not inside the view.`);
	}
	const { data } = await cdp("Page.captureScreenshot", {
		format: "png",
		clip: { x, y, width, height, scale: 1 },
	});
	const after = await evaluate(
		`document.querySelector(".status-bar")?.style.removeProperty("visibility"); return ${CURRENT_THEME};`,
	);
	// The file name promises a theme, and a window reload can still be applying the saved one.
	if (themeName && (target.theme !== themeName || after !== themeName)) {
		throw new Error(
			`The theme turned ${target.theme === themeName ? after : target.theme} around the capture of ${path.relative(root, path.resolve(file))}, not ${themeName}. Run it again.`,
		);
	}
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
	if (!recipe) {
		throw new Error(
			`Unknown state ${state}; use all, player or ${Object.keys(STATES).join(", ")}.`,
		);
	}
	const lib = await library();
	const dir = path.join(OUT, label);
	await seed(recipe.scene, recipe.extra);
	/** @type {{ file: string, caption: string }[][]} */
	const rows = [];
	try {
		for (const width of widths) {
			if (recipe.statusBar && width === "phone") continue;
			await place(width);
			const row = [];
			for (const name of themes) {
				await go(recipe.page(lib));
				if (recipe.open) {
					await evaluate(
						"app.plugins.plugins.podnotes.navigation.expand(); return true;",
					);
				}
				if (recipe.play !== undefined) await playback(recipe.play);
				if (recipe.paste) {
					execFileSync(
						process.execPath,
						[UI, "fill", '.podcast-view input[placeholder^="Search"]', lib.add.url],
						{ stdio: "inherit" },
					);
				}
				if (recipe.offline) await offline(true);
				await theme(name);
				if (recipe.statusBar) await statusItem(true);
				if (recipe.note) await episodeNote();
				if (recipe.press) await press(recipe.press);
				const file = path.join(dir, `${state}-${width}-${name}.png`);
				await shot(file, recipe.text?.(lib), name, recipe.statusBar);
				row.push({ file, caption: `${width} ${name} ${label}` });
				const prototype = path.join(DESIGN, `${state}-${width}-${name}.png`);
				if (fs.existsSync(prototype))
					row.push({ file: prototype, caption: `${width} ${name} prototype` });
			}
			rows.push(row);
		}
	} finally {
		if (recipe.offline) await offline(false);
		if (recipe.statusBar) await statusItem(false);
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
	else if (verb === "offline" && (target === "on" || target === "off"))
		await offline(target === "on");
	else if (verb === "shot" && target) await shot(target);
	else if (verb === "set" && target && rest[0] && /^[\w.-]+$/.test(rest[0])) {
		const widths = list(rest, "--widths", Object.keys(WIDTHS));
		const themes = list(rest, "--themes", Object.keys(THEMES));
		const unknown = [
			...widths.filter((name) => !(name in WIDTHS)),
			...themes.filter((name) => !(name in THEMES)),
		];
		if (unknown.length > 0) throw new Error(`Unknown width or theme: ${unknown.join(", ")}.`);
		const names = Object.keys(STATES);
		const states =
			target === "all"
				? names
				: target === "player"
					? names.filter((name) => STATES[name].play !== undefined)
					: [target];
		const failed = [];
		for (const state of states) {
			try {
				await set(state, rest[0], widths, themes);
			} catch (error) {
				console.error(
					`${state}: ${error instanceof Error ? error.message : String(error)}`,
				);
				failed.push(state);
			}
		}
		if (failed.length > 0) throw new Error(`Failed: ${failed.join(", ")}.`);
	} else {
		throw new Error(
			"Usage: screens.mjs place|theme|seed|go|offline|shot|set ... (see the header of this file)",
		);
	}
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
