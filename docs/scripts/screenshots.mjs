// Captures the docs screenshots from a lived-in vault, so they can be
// regenerated after any UI change. Run from the repo root after `npm run build`:
//
//   node docs/scripts/screenshots.mjs
//
// It builds a vault from docs/screenshots (notes, a Bases file, the theme, and
// PodNotes settings), launches a private Obsidian capture instance at 2x (on
// Linux under Xvfb), adds real podcast feeds through Settings, plays episodes,
// creates episode notes and captures timestamps with PodNotes' own commands,
// and writes every shot in light and dark to docs/public/screenshots. It needs
// network access for the feeds, their artwork, and the theme.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	captureLaunchCommand,
	captureScreenshot,
	connectCapture,
	evaluate,
	prepareCapture,
	prepareCaptureProfile,
	typeText,
	videoToGif,
	withRecording,
} from "obsidian-e2e/capture";
import sharp from "sharp";
import e2eConfig from "../../obsidian-e2e.config.mjs";

const docsDir = fileURLToPath(new URL("..", import.meta.url));
const repoDir = path.dirname(docsDir);
const seedDir = path.join(docsDir, "screenshots");
const outDir = path.join(docsDir, "public", "screenshots");
const seed = JSON.parse(await fs.readFile(path.join(seedDir, "seed.json"), "utf8"));
const vaultPath = path.join(repoDir, ".obsidian-e2e-vaults", "docs-screenshots", seed.vaultName);
const profileRoot = path.join(os.tmpdir(), "podnotes-docs-capture");
const cdpPort = 9400 + Math.floor(Math.random() * 400);
const WINDOW = { width: 1440, height: 1000 };
const DEMO_WINDOW = { width: 1200, height: 750 };
const PHONE = { width: 390, height: 844 };
// Wide enough that the artwork, title, and progress lead the player.
const SIDEBAR = 430;
const PLAYER = '.workspace-leaf-content[data-type="podcast_player_view"]';
const ROOT = ".workspace-split.mod-root";
// Linux draws scrollbars that macOS hides until you scroll, and window buttons
// that belong to the operating system, not to Obsidian.
const CAPTURE_CSS = "::-webkit-scrollbar, .titlebar-button-container { display: none; }";
const CROP_CSS = `${CAPTURE_CSS} .status-bar { display: none; }`;

async function writeJson(file, value) {
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, `${JSON.stringify(value, null, "\t")}\n`);
}

async function buildVault() {
	for (const artifact of ["main.js", "manifest.json"]) {
		await fs.access(path.join(repoDir, artifact)).catch(() => {
			throw new Error(`Missing ${artifact}. Run npm run build first.`);
		});
	}
	await fs.rm(path.dirname(vaultPath), { recursive: true, force: true });
	await fs.cp(path.join(seedDir, "vault"), vaultPath, { recursive: true });
	const config = path.join(vaultPath, ".obsidian");
	const pluginDir = path.join(config, "plugins", "podnotes");
	await fs.mkdir(pluginDir, { recursive: true });
	for (const artifact of ["main.js", "manifest.json"]) {
		await fs.symlink(path.join(repoDir, artifact), path.join(pluginDir, artifact));
	}
	await writeJson(path.join(pluginDir, "data.json"), {
		...e2eConfig.defaultData,
		...seed.settings,
		note: { ...e2eConfig.defaultData.note, template: seed.noteTemplate },
	});
	await writeJson(path.join(config, "community-plugins.json"), ["podnotes"]);
	const on = ["file-explorer", "global-search", "switcher", "graph", "backlink", "outgoing-link"];
	on.push("tag-pane", "properties", "page-preview", "daily-notes", "templates", "note-composer");
	on.push(
		"command-palette",
		"editor-status",
		"bookmarks",
		"outline",
		"word-count",
		"file-recovery",
		"bases",
	);
	const off = ["canvas", "random-note", "slash-command", "markdown-importer", "zk-prefixer"];
	off.push("audio-recorder", "workspaces", "publish", "sync", "slides", "webviewer");
	await writeJson(path.join(config, "core-plugins.json"), {
		...Object.fromEntries(on.map((id) => [id, true])),
		...Object.fromEntries(off.map((id) => [id, false])),
	});
	await writeJson(path.join(config, "app.json"), {
		showInlineTitle: true,
		readableLineLength: true,
		promptDelete: false,
		// Settings open in the main window, where the capture can reach them.
		settingsPopoutWindow: false,
		mobileToolbarCommands: [
			"podnotes:capture-timestamp",
			"editor:toggle-bold",
			"editor:insert-wikilink",
			"editor:toggle-checklist-status",
			"editor:undo",
		],
	});
	await writeJson(path.join(config, "appearance.json"), {
		cssTheme: seed.theme.name,
		theme: "moonstone",
		interfaceFontFamily: "Inter",
		textFontFamily: "Inter",
		baseFontSize: 16,
	});
	await writeJson(path.join(config, "daily-notes.json"), {
		folder: "Daily",
		template: "Templates/Daily note",
	});
	await writeJson(path.join(config, "templates.json"), { folder: "Templates" });
	const themeDir = path.join(config, "themes", seed.theme.name);
	await fs.mkdir(themeDir, { recursive: true });
	for (const file of ["theme.css", "manifest.json"]) {
		const url = `https://github.com/${seed.theme.repo}/releases/download/${seed.theme.version}/${file}`;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`${url} returned ${response.status}`);
		await fs.writeFile(path.join(themeDir, file), Buffer.from(await response.arrayBuffer()));
	}
}

async function launch() {
	const options = { vaultPath, root: profileRoot, cdpPort, scale: 2 };
	await fs.rm(profileRoot, { recursive: true, force: true });
	const profile = await prepareCaptureProfile(options);
	const command = captureLaunchCommand(options, profile);
	const child = spawn(command.file, command.args, {
		env: command.env,
		cwd: command.cwd,
		stdio: "ignore",
		detached: true,
	});
	const stop = () => {
		try {
			process.kill(-child.pid, "SIGKILL");
		} catch {}
	};
	process.on("exit", stop);
	return { client: await connectCapture({ port: cdpPort, timeoutMs: 90_000 }), stop };
}

async function main() {
	await buildVault();
	const instance = await launch();
	const { stop } = instance;
	let { client } = instance;
	const api = "app.plugins.plugins.podnotes.api";
	/** Runs `body` as an async function in Obsidian and returns its value. */
	const run = (body) => evaluate(client, `(async () => { ${body} })()`);
	const waitFor = (expression, what, ms = 30_000) =>
		run(`for (const end = Date.now() + ${ms}; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
			const value = ${expression};
			if (value) return value;
		}
		throw new Error(${JSON.stringify(`Timed out waiting for ${what}`)});`);
	const click = (selector, text) =>
		run(`for (const end = Date.now() + 30000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
			const match = [...document.querySelectorAll(${JSON.stringify(selector)})].find((el) =>
				el.getClientRects().length > 0 && ${text === undefined ? "true" : `el.textContent.trim().includes(${JSON.stringify(text)})`});
			if (match) { match.click(); return true; }
		}
		throw new Error(${JSON.stringify(`Nothing to click: ${selector} ${text ?? ""}`)});`);
	const fill = (selector, value) =>
		run(`const input = document.querySelector(${JSON.stringify(selector)});
			input.focus();
			input.value = ${JSON.stringify(value)};
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return true;`);
	const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

	/** Writes `<name>.webp` in light and `<name>-dark.webp` in dark. */
	async function shoot(name, target, { css = CROP_CSS, size = WINDOW, clean = true } = {}) {
		await fs.mkdir(outDir, { recursive: true });
		for (const theme of ["light", "dark"]) {
			await prepareCapture(client, {
				...size,
				scale: 2,
				theme,
				font: "Inter",
				hideSecretWarning: true,
				css,
			});
			// The Xvfb pointer rests mid-screen and would leave a hover state, so park
			// it over empty space.
			await client.call("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: 130,
				y: size.height - 80,
			});
			await run(
				`document.querySelectorAll(".has-focus").forEach((el) => el.classList.remove("has-focus")); return true;`,
			);
			await waitFor(
				`[...document.images].every((img) => { const r = img.getBoundingClientRect(); return img.complete || r.width === 0 || r.bottom < 0 || r.top > innerHeight; })`,
				"images to load",
			);
			await settle(400);
			const png = path.join(profileRoot, `${name}-${theme}.png`);
			await captureScreenshot(client, png, { target, clean });
			await sharp(png)
				.webp({ quality: 86 })
				.toFile(path.join(outDir, `${name}${theme === "dark" ? "-dark" : ""}.webp`));
		}
		await prepareCapture(client, { theme: "light", css: CAPTURE_CSS });
	}

	/**
	 * A crop of `selector` from its top to the bottom of its `count`th visible
	 * `item`, stopping short of the next item so no sliver of it shows.
	 */
	const cropTo = (selector, item, count, pad = 16) => ({
		kind: "rect",
		expression: `(() => {
			const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
			const items = [...document.querySelectorAll(${JSON.stringify(`${selector} ${item}`)})].filter((el) => el.getClientRects().length > 0);
			const last = items[${count - 1}].getBoundingClientRect();
			const next = items[${count}]?.getBoundingClientRect().top ?? Infinity;
			const bottom = Math.min(last.bottom + ${pad}, next - 2, box.bottom);
			return { x: box.x, y: box.y, width: box.width, height: bottom - box.y };
		})()`,
	});

	/** A crop of the episode note's text column, between two of its lines. */
	const noteCrop = (fromLine, toLine) => ({
		kind: "rect",
		expression: `(() => {
			const view = app.workspace.getLeavesOfType("markdown")[0].view.contentEl;
			const column = view.querySelector(".cm-sizer").getBoundingClientRect();
			const lines = [...view.querySelectorAll(".inline-title, .metadata-container, .cm-line, .callout")];
			const top = Math.max(0, (${fromLine})(lines).getBoundingClientRect().top - 20);
			const bottom = Math.min(innerHeight, (${toLine})(lines).getBoundingClientRect().bottom + 20);
			const left = Math.max(0, column.x - 16);
			const right = Math.min(innerWidth, column.right + 16);
			return { x: left, y: top, width: right - left, height: bottom - top };
		})()`,
	});

	// Picks episodes from Latest Episodes. On this capture host a selected
	// podcast with hundreds of episodes can stall before its list renders, and
	// a fresh view can show no episodes until Refresh, which a user would select.
	async function showLatest() {
		await click('.podcast-view [aria-label="Episode list"]');
		await run(`document.querySelector(".podcast-view .go-back")?.click(); return true;`);
		const shown = await run(
			`return document.querySelectorAll(".podcast-view .podcast-episode-item").length;`,
		);
		if (!shown) await click('.podcast-view [aria-label="Refresh episodes"]');
		await waitFor(
			`document.querySelectorAll(".podcast-view .podcast-episode-item").length > 0`,
			"the latest episodes",
		);
	}

	/**
	 * Records the README demo: capture a timestamp from the command palette and
	 * type a note after it. The note text goes in through the editor API, because
	 * the headless window does not keep keyboard focus in the editor.
	 */
	async function recordDemo(theme) {
		await prepareCapture(client, {
			...DEMO_WINDOW,
			scale: 2,
			theme,
			font: "Inter",
			hideSecretWarning: true,
			css: CAPTURE_CSS,
		});
		await run(`app.workspace.leftSplit.collapse();
			app.workspace.rightSplit.setSize(360);
			const leaf = app.workspace.getLeavesOfType("markdown")[0];
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const editor = leaf.view.editor;
			const lines = [...Array(editor.lineCount()).keys()];
			const last = lines.findLast((i) => /^- \\[\\d/.test(editor.getLine(i)));
			editor.setCursor(last, editor.getLine(last).length);
			editor.replaceSelection("\\n");
			const heading = lines.find((i) => editor.getLine(i) === "## Notes");
			const view = editor.cm;
			view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(heading + 1).from).top - 24;
			${api}.currentTime = ${seed.demo.at};
			return true;`);
		await client.call("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: 130,
			y: DEMO_WINDOW.height - 80,
		});
		await settle(800);
		const video = path.join(profileRoot, `demo-${theme}.mp4`);
		await withRecording(
			client,
			video,
			async () => {
				await settle(1200);
				await run(`app.commands.executeCommandById("command-palette:open"); return true;`);
				await settle(500);
				await typeText(client, "capture timestamp", {
					delayMs: 70,
					selector: ".prompt-input",
				});
				await settle(700);
				for (const type of ["keyDown", "keyUp"]) {
					await client.call("Input.dispatchKeyEvent", {
						type,
						key: "Enter",
						code: "Enter",
						windowsVirtualKeyCode: 13,
					});
				}
				await settle(900);
				await run(`const editor = app.workspace.getLeavesOfType("markdown")[0].view.editor;
					for (const ch of ${JSON.stringify(seed.demo.note)}) {
						editor.replaceSelection(ch);
						await new Promise((r) => setTimeout(r, 45));
					}
					return true;`);
				await settle(2200);
			},
			{ fps: 24, backend: "screencast" },
		);
		await videoToGif(video, path.join(outDir, `demo${theme === "dark" ? "-dark" : ""}.gif`), {
			width: DEMO_WINDOW.width,
			fps: 12,
		});
	}

	// Properties first, while the editor and the file agree, then the notes
	// through the editor with PodNotes' own capture command, then save.
	async function writeNote(episode) {
		await run(`await app.fileManager.processFrontMatter(app.workspace.getActiveFile(), (fm) => {
				fm.status = ${JSON.stringify(episode.status)};
				${episode.rating === undefined ? "" : `fm.rating = ${episode.rating};`}
			});
			return true;`);
		await waitFor(
			`app.workspace.activeEditor?.editor?.getValue().includes(${JSON.stringify(`status: ${episode.status}`)})`,
			`the properties of ${episode.title}`,
		);
		if (!episode.notes) return;
		const lines = (await fs.readFile(path.join(seedDir, "notes", episode.notes), "utf8"))
			.trimEnd()
			.split("\n");
		for (const line of lines) {
			const at = line.match(/^\{\{at (\d+):(\d\d):(\d\d)\}\} (.*)$/);
			await run(`const editor = app.workspace.activeEditor.editor;
				editor.focus();
				editor.setCursor(editor.lastLine(), editor.getLine(editor.lastLine()).length);
				return true;`);
			if (at) {
				const seconds = Number(at[1]) * 3600 + Number(at[2]) * 60 + Number(at[3]);
				await run(`${api}.currentTime = ${seconds};
					app.commands.executeCommandById("podnotes:capture-timestamp");
					app.workspace.activeEditor.editor.replaceSelection(${JSON.stringify(`${at[4]}\n`)});
					return true;`);
			} else {
				await run(
					`app.workspace.activeEditor.editor.replaceSelection(${JSON.stringify(`${line}\n`)}); return true;`,
				);
			}
		}
		await run(`await app.workspace.activeEditor.save(); return true;`);
	}

	try {
		await run(`await app.plugins.setEnable(true);
			document.querySelectorAll(".modal-container").forEach((m) => m.remove());
			await app.plugins.loadManifests();
			await app.plugins.enablePluginAndSave("podnotes");
			return true;`);
		await waitFor(api, "PodNotes to load");
		await prepareCapture(client, {
			...WINDOW,
			scale: 2,
			theme: "light",
			font: "Inter",
			hideSecretWarning: true,
			css: CAPTURE_CSS,
		});

		// Add the feeds the way a user does: Settings, then Search Podcasts.
		await run(`app.setting.open(); app.setting.openTabById("podnotes"); return true;`);
		const search = 'input[placeholder="Search or enter feed URL..."]';
		await waitFor(
			`document.querySelector(${JSON.stringify(search)})`,
			"the podcast search field",
		);
		for (const feed of seed.feeds) {
			await fill(search, feed);
			const label = await waitFor(
				`document.querySelector('.modal.mod-settings [aria-label^="Add "][aria-label$=" podcast"]')?.getAttribute("aria-label")`,
				`a result for ${feed}`,
			);
			await click(`[aria-label="${label}"]`);
			const title = label.slice("Add ".length, -" podcast".length);
			await waitFor(
				`app.plugins.plugins.podnotes.settings.savedFeeds[${JSON.stringify(title)}]`,
				`${title} to save`,
			);
		}
		await fill(search, seed.search);
		await waitFor(
			`document.querySelectorAll(".podcast-query-results > *").length >= 4`,
			"search results",
		);
		await settle(2500);
		await shoot(
			"add-podcast",
			{ kind: "rect", expression: SEARCH_SECTION },
			{ css: `${CAPTURE_CSS} ${FIRST_FOUR_RESULTS}` },
		);
		const { playlist } = seed;
		await run(`const form = document.querySelector(".modal.mod-settings .add-playlist-container");
			const icon = form.querySelector("select");
			icon.value = ${JSON.stringify(playlist.icon)};
			icon.dispatchEvent(new Event("change", { bubbles: true }));
			const name = form.querySelector('input[placeholder="Playlist name"]');
			name.value = ${JSON.stringify(playlist.name)};
			name.dispatchEvent(new Event("input", { bubbles: true }));
			return true;`);
		await click('[aria-label="Add playlist"]');
		await waitFor(
			`app.plugins.plugins.podnotes.settings.playlists[${JSON.stringify(playlist.name)}]`,
			"the playlist",
		);
		await run(`app.setting.close(); return true;`);

		// Play each episode, write its note, and leave the last one playing.
		await run(`app.commands.executeCommandById("podnotes:podnotes-show-leaf"); return true;`);
		await waitFor(
			`document.querySelector(${JSON.stringify(PLAYER)})?.getClientRects().length`,
			"the PodNotes view",
		);
		await run(`app.workspace.rightSplit.setSize(${SIDEBAR}); return true;`);
		const notePaths = new Map();
		for (const episode of seed.episodes) {
			await showLatest();
			await fill('.podcast-view input[placeholder="Search episodes"]', episode.title);
			await click(".podcast-view .podcast-episode-item", episode.title);
			await waitFor(
				`${api}.podcast?.title === ${JSON.stringify(episode.title)}`,
				episode.title,
			);
			await waitFor(`${api}.length > 0`, `${episode.title} to load`);
			const before = await run(`return app.workspace.getActiveFile()?.path ?? null;`);
			await run(
				`app.commands.executeCommandById("podnotes:create-podcast-note"); return true;`,
			);
			const note = await waitFor(
				`(() => { const p = app.workspace.getActiveFile()?.path; return p && p !== ${JSON.stringify(before)} && p.startsWith("PodNotes/") ? p : null; })()`,
				`the note for ${episode.title}`,
			);
			notePaths.set(episode, note);
			await writeNote(episode);
		}
		for (const podcast of seed.feedNotes) {
			await run(
				`app.commands.executeCommandById("podnotes:create-podcast-feed-note"); return true;`,
			);
			await waitFor(`document.querySelector(".prompt-input")`, "the podcast picker");
			await fill(".prompt-input", podcast);
			await click(".suggestion-item", podcast);
			await waitFor(
				`app.workspace.getActiveFile()?.path === ${JSON.stringify(`PodNotes/Podcasts/${podcast}.md`)}`,
				`the feed note for ${podcast}`,
			);
		}

		// Fill the playlist, and keep only titles that fit their rows in the
		// queue: a longer title runs under the row's menu button.
		for (const title of playlist.episodes) {
			await showLatest();
			await fill('.podcast-view input[placeholder="Search episodes"]', title);
			await click(
				`.podcast-view [aria-label=${JSON.stringify(`More options for ${title}`)}]`,
			);
			await click(".menu .menu-item", `Add to ${playlist.name}`);
		}
		await fill('.podcast-view input[placeholder="Search episodes"]', "");
		await click('.podcast-view [aria-label^="Player"]');
		const longTitles =
			await run(`return [...document.querySelectorAll(".podcast-view .podcast-episode-row .episode-item-title")]
			.map((el) => el.textContent.trim())
			.filter((title) => title.length > ${seed.maxTitleLength});`);
		for (const title of longTitles) {
			await click(
				`.podcast-view [aria-label=${JSON.stringify(`More options for ${title}`)}]`,
			);
			await click(".menu .menu-item", "Remove from Queue");
		}

		const hero = seed.episodes.at(-1);
		await run(`const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePaths.get(hero))});
			const leaves = [];
			app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));
			await leaves[0].openFile(file);
			for (const leaf of leaves.slice(1)) leaf.detach();
			app.workspace.setActiveLeaf(leaves[0], { focus: false });
			const explorer = app.workspace.getLeavesOfType("file-explorer")[0];
			await explorer.loadIfDeferred?.();
			explorer.view.revealInFolder(file);
			${api}.currentTime = ${hero.playAt};
			${api}.playbackRate = ${hero.playbackRate};
			if (!${api}.isPlaying) ${api}.start();
			return true;`);
		await waitFor(
			`app.workspace.getActiveFile()?.path === ${JSON.stringify(notePaths.get(hero))}`,
			"the hero note",
		);
		await click('.podcast-view [aria-label^="Player"]');
		await settle(1500);
		const scrollNote = (line) =>
			run(`const editor = app.workspace.getLeavesOfType("markdown")[0].view.editor;
				const view = editor.cm;
				const index = [...Array(editor.lineCount()).keys()].find((i) => editor.getLine(i) === ${JSON.stringify(line)}) ?? 0;
				view.scrollDOM.scrollTop = ${JSON.stringify(line)} ? view.lineBlockAt(view.state.doc.line(index + 1).from).top - 40 : 0;
				return true;`);
		const showProperties = (open) =>
			run(`const box = app.workspace.getLeavesOfType("markdown")[0].view.contentEl.querySelector(".metadata-container");
				if (box.classList.contains("is-collapsed") === ${open}) box.querySelector(".metadata-properties-heading").click();
				await new Promise((r) => setTimeout(r, 300));
				return true;`);
		const episodeNote = noteCrop(
			`(lines) => lines.find((el) => el.matches(".inline-title"))`,
			`(lines) => lines.find((el) => el.matches(".callout"))`,
		);
		const notesSection = noteCrop(
			`(lines) => lines.find((el) => el.textContent.trim() === "Notes")`,
			`(lines) => lines.filter((el) => el.matches(".cm-line") && el.textContent.trim()).at(-1)`,
		);
		await shoot("episode-note", episodeNote);
		// The hero folds the properties away so the captured timestamps sit mid-window.
		await showProperties(false);
		await shoot("hero", { kind: "viewport" }, { css: CAPTURE_CSS });
		// The social preview: the top of the light hero at 1200x630.
		await sharp(path.join(profileRoot, "hero-light.png"))
			.resize(1200, 630, { fit: "cover", position: "top" })
			.png({ compressionLevel: 9, palette: true })
			.toFile(path.join(outDir, "og.png"));
		await scrollNote("## Notes");
		await shoot("timestamps", notesSection);
		await scrollNote("");
		await shoot("player", cropTo(PLAYER, ".controls-container", 1, 20));
		const heroNote = notePaths.get(hero);
		const heroText = await run(`return app.vault.adapter.read(${JSON.stringify(heroNote)});`);
		for (const theme of ["light", "dark"]) {
			await recordDemo(theme);
			await run(
				`await app.vault.adapter.write(${JSON.stringify(heroNote)}, ${JSON.stringify(heroText)}); return true;`,
			);
			await settle(800);
		}
		await run(
			`app.workspace.leftSplit.expand(); app.workspace.rightSplit.setSize(${SIDEBAR}); return true;`,
		);

		await click('.podcast-view [aria-label="Podcast grid"]');
		await click(`.podcast-view [aria-label=${JSON.stringify(playlist.name)}]`);
		await waitFor(
			`document.querySelectorAll(".podcast-view .podcast-episode-item").length >= ${playlist.episodes.length}`,
			"the playlist episodes",
		);
		await settle(1500);
		await shoot(
			"episode-list",
			cropTo(PLAYER, ".podcast-episode-item", playlist.episodes.length, 12),
		);
		await click('.podcast-view [aria-label="Podcast grid"]');
		await settle(1500);
		await shoot("podcast-grid", cropTo(PLAYER, ".pn_image_container", 4));

		await run(`app.workspace.rightSplit.collapse();
			await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath("PodNotes/Episodes.base"));
			return true;`);
		await settle(2000);
		await shoot("bases", {
			kind: "rect",
			expression: `(() => {
				const box = document.querySelector('.workspace-leaf-content[data-type="bases"]').getBoundingClientRect();
				const rows = [...document.querySelectorAll('.workspace-leaf-content[data-type="bases"] .bases-tr')];
				const last = rows.at(-1).getBoundingClientRect();
				const right = Math.max(...rows.flatMap((row) => [...row.children].map((cell) => cell.getBoundingClientRect().right)));
				return { x: box.x, y: box.y, width: Math.min(box.width, right - box.x + 24), height: last.bottom + 32 - box.y };
			})()`,
		});
		// Obsidian's mobile layout at phone size. The switch reloads the window, so
		// pause first and reconnect after.
		await run(`${api}.stop(); return true;`);
		await settle(1000);
		await run(`app.emulateMobile(true); return true;`);
		await settle(4000);
		client.close();
		client = await connectCapture({ port: cdpPort, timeoutMs: 90_000 });
		await prepareCapture(client, {
			...PHONE,
			scale: 2,
			theme: "light",
			font: "Inter",
			hideSecretWarning: true,
			css: CAPTURE_CSS,
		});
		const phone = { css: CAPTURE_CSS, size: PHONE };
		await run(`app.setting.open(); app.setting.openTabById("podnotes"); return true;`);
		await fill(search, seed.search);
		await waitFor(
			`document.querySelectorAll(".podcast-query-results > *").length >= 4`,
			"search results",
		);
		await settle(2500);
		await shoot(
			"add-podcast-phone",
			{ kind: "rect", expression: SEARCH_SECTION },
			{ ...phone, css: `${CAPTURE_CSS} ${FIRST_FOUR_RESULTS}` },
		);
		await run(`app.setting.close(); return true;`);
		await run(`app.workspace.leftSplit.collapse();
			app.workspace.rightSplit.collapse();
			await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath("PodNotes/Episodes.base"));
			return true;`);
		await settle(2000);
		await shoot(
			"bases-phone",
			{
				kind: "rect",
				expression: `(() => {
					const box = document.querySelector('.workspace-leaf-content[data-type="bases"]').getBoundingClientRect();
					const last = [...document.querySelectorAll('.workspace-leaf-content[data-type="bases"] .bases-tr')].at(-1).getBoundingClientRect();
					return { x: box.x, y: box.y, width: box.width, height: Math.min(innerHeight, last.bottom + 24) - box.y };
				})()`,
			},
			phone,
		);
		await run(`await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(${JSON.stringify(notePaths.get(hero))}));
			return true;`);
		await settle(1000);
		await showProperties(true);
		await scrollNote("");
		await shoot("episode-note-phone", episodeNote, phone);
		await showProperties(false);
		await scrollNote("## Notes");
		await shoot("timestamps-phone", notesSection, phone);
		await run(`const editor = app.workspace.activeEditor.editor;
			const last = [...Array(editor.lineCount()).keys()].findLast((i) => /^- \\[\\d/.test(editor.getLine(i)));
			editor.focus();
			editor.setCursor(last, editor.getLine(last).length);
			return true;`);
		await scrollNote("## Notes");
		await settle(1500);
		// Not cleaned: the toolbar shows only while the editor has focus.
		await shoot(
			"mobile-toolbar",
			{
				kind: "rect",
				expression: `(() => {
					const lines = [...app.workspace.getLeavesOfType("markdown")[0].view.contentEl.querySelectorAll(".cm-line")];
					const top = lines.find((el) => el.textContent.trim() === "Notes").getBoundingClientRect().top - 16;
					return { x: 0, y: top, width: innerWidth, height: innerHeight - top };
				})()`,
			},
			{ css: `${CAPTURE_CSS} .cm-cursorLayer { display: none; }`, size: PHONE, clean: false },
		);
		await run(`app.commands.executeCommandById("podnotes:podnotes-show-leaf"); return true;`);
		await settle(2000);
		await click('.podcast-view [aria-label^="Player"]');
		await run(`${api}.currentTime = ${hero.playAt}; ${api}.start(); return true;`);
		await settle(1500);
		await shoot(
			"mobile-player",
			{
				kind: "rect",
				expression: `(() => {
					const drawer = document.querySelector(".podcast-view").closest(".workspace-drawer, .workspace-split").getBoundingClientRect();
					const controls = document.querySelector(".podcast-view .controls-container").getBoundingClientRect();
					return { x: drawer.x, y: drawer.y, width: drawer.width, height: controls.bottom + 24 - drawer.y };
				})()`,
			},
			{ css: CAPTURE_CSS, size: PHONE },
		);
		console.log(`Wrote screenshots to ${path.relative(repoDir, outDir)}`);
	} finally {
		client.close();
		stop();
	}
}

// Shows only the first four search results, so the settings card ends with them.
const FIRST_FOUR_RESULTS = ".podcast-query-results > :nth-child(n + 5) { display: none; }";

// The settings card that holds Search Podcasts, its field, and the results.
const SEARCH_SECTION = `(() => {
	const tab = document.querySelector(".modal.mod-settings .vertical-tab-content");
	const name = [...tab.querySelectorAll(".setting-item-heading .setting-item-name")].find((n) => n.textContent.trim() === "Search Podcasts");
	const heading = name.closest(".setting-item").getBoundingClientRect();
	const container = tab.querySelector(".podcast-query-container");
	let card = container.parentElement;
	while (card !== tab && getComputedStyle(card).backgroundColor === "rgba(0, 0, 0, 0)") card = card.parentElement;
	const box = (card === tab ? container : card).getBoundingClientRect();
	const pad = Math.max(12, heading.top - box.top);
	const rows = [...container.querySelectorAll(".podcast-query-results > *")].filter((el) => el.getClientRects().length > 0);
	const bottom = Math.min(box.bottom, Math.max(...rows.map((el) => el.getBoundingClientRect().bottom)) + pad);
	const top = card === tab ? heading.top - pad : box.top;
	return { x: box.x, y: top, width: box.width, height: bottom - top };
})()`;

await main();
