import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { FIXTURE_HOST } from "../../../../scripts/e2e-instance.mjs";
import { config, evaluate, FIXTURES, provision, waitFor } from "./instance.mjs";

const DATA_PATH = path.join(provision.vaultPath, ".obsidian/plugins/podnotes/data.json");

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
 * @property {string} [notice] Text an Obsidian notice shows, which the shot keeps.
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
export const STATES = {
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
	// The capture's notice, which has to outlast the shot.
	capture: { ...FULL_PLAYER, note: true, press: "Timestamp", notice: "Timestamp added to" },
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

/** @returns {Promise<Library>} */
export async function library() {
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
export async function seed(scene, extra) {
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
