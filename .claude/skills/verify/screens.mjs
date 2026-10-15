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
//         Restores the desktop pane after captures, including when a state fails.
//         States: first-run, add-podcast, library, episodes, error-feed, queue,
//         playlists, playlist, latest, played, local-files, offline, status-bar, and the
//         player's: now-playing, mini-player, capture, chapters, up-next, up-next-empty,
//         transcript, no-chapters, video, local-player, media-error. player runs the player's states
//         and all runs every state; both go on past a failed state and fail at the end.
//         status-bar is the queue with the mini player and a "9 properties" item in
//         Obsidian's status bar, which that state's shots keep. It has no phone shot:
//         Obsidian hides the status bar on mobile.
//         A player state plays the scene's current episode until its media loads, then
//         pauses it at a fixed second, and opens the full player over the Library;
//         mini-player stays on the podcast's page. media-error waits for the load to
//         fail instead. capture, chapters, up-next, up-next-empty and transcript then press the full
//         player's Timestamp, Chapters, Up next or Transcript button with real input, so they fail
//         at once on a full player without a button that reads exactly that. capture
//         keeps the "Timestamp added to" notice in its shots.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	episodeNote,
	evaluate,
	go,
	offline,
	place,
	playback,
	press,
	root,
	shot,
	statusItem,
	theme,
	THEMES,
	UI,
	WIDTHS,
} from "./screens/instance.mjs";
import { library, seed, STATES } from "./screens/scenes.mjs";
import { contactSheet } from "./screens/sheet.mjs";

const OUT = path.join(root, ".obsidian-e2e-artifacts/screens");
const DESIGN = path.join(os.homedir(), ".claude/orchestrate/podnotes/design/screens");

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
				// Notices from earlier shots would stand above the one the press shows.
				if (recipe.notice) {
					await evaluate(
						`document.querySelectorAll(".notice").forEach((n) => n.remove()); return true;`,
					);
				}
				if (recipe.press) await press(recipe.press);
				const file = path.join(dir, `${state}-${width}-${name}.png`);
				await shot(file, recipe.text?.(lib), name, recipe.statusBar, recipe.notice);
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
		try {
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
		} finally {
			await place("pane");
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
