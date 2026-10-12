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
const DEMO_WINDOW = { width: 1200, height: 900 };
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
	/**
	 * Runs `body` as an async function in Obsidian and returns its value. The
	 * body is fixed code: every value it needs arrives as the CDP call's
	 * argument, `args`, so no value is ever written into code.
	 */
	async function run(body, args = {}) {
		const { result } = await client.call("Runtime.evaluate", { expression: "globalThis" });
		const reply = await client.call("Runtime.callFunctionOn", {
			objectId: result.objectId,
			functionDeclaration: `async function (args) { ${body} }`,
			arguments: [{ value: args }],
			awaitPromise: true,
			returnByValue: true,
		});
		if (reply.exceptionDetails) {
			const { exception, text } = reply.exceptionDetails;
			throw new Error(exception?.description ?? text);
		}
		return reply.result.value;
	}
	/** Polls `expression`, which can read `args`, until it is truthy and returns it. */
	const waitFor = (expression, what, args = {}) =>
		run(
			`for (const end = Date.now() + 30000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
				const value = ${expression};
				if (value) return value;
			}
			throw new Error("Timed out waiting for " + args.waitingFor);`,
			{ ...args, waitingFor: what },
		);
	const click = (selector, text) =>
		run(
			`for (const end = Date.now() + 30000; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) {
				const match = [...document.querySelectorAll(args.selector)].find((el) =>
					el.getClientRects().length > 0 && (args.text === undefined || el.textContent.trim().includes(args.text)));
				if (match) { match.click(); return true; }
			}
			throw new Error("Nothing to click: " + args.selector + " " + (args.text ?? ""));`,
			{ selector, text },
		);
	const fill = (selector, value) =>
		run(
			`const input = document.querySelector(args.selector);
			input.focus();
			input.value = args.value;
			input.dispatchEvent(new Event("input", { bubbles: true }));
			return true;`,
			{ selector, value },
		);
	const settle = (ms = 600) => new Promise((resolve) => setTimeout(resolve, ms));

	/**
	 * Writes `<name>.webp` in light and `<name>-dark.webp` in dark. A rect target
	 * is `{ kind: "rect", body, args }`: `body` returns `{ x, y, width, height }`
	 * and reads its values from `args`.
	 */
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
			// it over empty space: the desktop file explorer, or the phone note's left
			// margin, which the open sidebar leaves uncovered.
			await client.call("Input.dispatchMouseEvent", {
				type: "mouseMoved",
				x: size.width === PHONE.width ? 8 : 130,
				y: size.width === PHONE.width ? 160 : size.height - 80,
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
			// The capture measures the rect after its own clean-up, so it calls a
			// closure that holds the values rather than code built from them.
			if (target.kind === "rect")
				await run(
					`globalThis.captureRect = () => { ${target.body} }; return true;`,
					target.args,
				);
			const capture =
				target.kind === "rect"
					? { kind: "rect", expression: "globalThis.captureRect()" }
					: target;
			await captureScreenshot(client, png, { target: capture, clean });
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
		body: `const box = document.querySelector(args.selector).getBoundingClientRect();
			const items = [...document.querySelectorAll(args.items)].filter((el) => el.getClientRects().length > 0);
			const last = items[args.count - 1].getBoundingClientRect();
			const next = items[args.count]?.getBoundingClientRect().top ?? Infinity;
			const bottom = Math.min(last.bottom + args.pad, next - 2, box.bottom);
			return { x: box.x, y: box.y, width: box.width, height: bottom - box.y };`,
		args: { selector, items: `${selector} ${item}`, count, pad },
	});

	/** A crop of the episode note's text column, between two of its lines. */
	const noteCrop = (fromLine, toLine) => ({
		kind: "rect",
		body: `const leaf = app.workspace.getLeavesOfType("markdown")[0].view;
			const view = leaf.contentEl;
			const pane = view.getBoundingClientRect();
			const header = leaf.containerEl.querySelector(".view-header").getBoundingClientRect();
			const column = view.querySelector(".cm-sizer").getBoundingClientRect();
			const lines = [...view.querySelectorAll(".inline-title, .metadata-container, .cm-line, .callout")];
			// On a phone the header floats over the note and casts a shadow, and the
			// navigation bar sits over its bottom.
			const navbar = document.querySelector(".mobile-navbar")?.getBoundingClientRect().top ?? innerHeight;
			const top = Math.max(pane.top, header.bottom + 12, (${fromLine})(lines).getBoundingClientRect().top - 16);
			const bottom = Math.min(pane.bottom, navbar - 12, (${toLine})(lines).getBoundingClientRect().bottom + 12);
			const left = Math.max(pane.left, column.x - 16);
			const right = Math.min(pane.right, column.right + 16);
			return { x: left, y: top, width: right - left, height: bottom - top };`,
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
		// Both takes open the palette on the same list, not on the last take's command.
		await run(
			`app.internalPlugins.getPluginById("command-palette").instance.recentCommands = [];
			app.workspace.leftSplit.collapse();
			app.workspace.rightSplit.setSize(360);
			const leaf = app.workspace.getLeavesOfType("markdown")[0];
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const editor = leaf.view.editor;
			const lines = [...Array(editor.lineCount()).keys()];
			const last = lines.findLast((i) => /^- \\[\\d/.test(editor.getLine(i)));
			editor.setCursor(last, editor.getLine(last).length);
			editor.replaceSelection("\\n");
			// The note is too short to scroll its Notes heading to the top, so start at
			// the artwork rather than part way through it.
			const artwork = lines.find((i) => editor.getLine(i).startsWith("!["));
			const view = editor.cm;
			view.scrollDOM.scrollTop = view.lineBlockAt(view.state.doc.line(artwork + 1).from).top - 16;
			${api}.currentTime = args.at;
			return true;`,
			{ at: seed.demo.at },
		);
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
				await run(
					`const editor = app.workspace.getLeavesOfType("markdown")[0].view.editor;
					for (const ch of args.note) {
						editor.replaceSelection(ch);
						await new Promise((r) => setTimeout(r, 45));
					}
					return true;`,
					{ note: seed.demo.note },
				);
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
		await run(
			`await app.fileManager.processFrontMatter(app.workspace.getActiveFile(), (fm) => {
				fm.status = args.status;
				if (args.rating !== undefined) fm.rating = args.rating;
			});
			return true;`,
			{ status: episode.status, rating: episode.rating },
		);
		await waitFor(
			`app.workspace.activeEditor?.editor?.getValue().includes(args.text)`,
			`the properties of ${episode.title}`,
			{ text: `status: ${episode.status}` },
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
				await run(
					`${api}.currentTime = args.seconds;
					app.commands.executeCommandById("podnotes:capture-timestamp");
					app.workspace.activeEditor.editor.replaceSelection(args.text);
					return true;`,
					{ seconds, text: `${at[4]}\n` },
				);
			} else {
				await run(
					`app.workspace.activeEditor.editor.replaceSelection(args.text); return true;`,
					{
						text: `${line}\n`,
					},
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
		await waitFor(`document.querySelector(args.selector)`, "the podcast search field", {
			selector: search,
		});
		for (const feed of seed.feeds) {
			await fill(search, feed);
			const label = await waitFor(
				`document.querySelector('.modal.mod-settings [aria-label^="Add "][aria-label$=" podcast"]')?.getAttribute("aria-label")`,
				`a result for ${feed}`,
			);
			await click(`[aria-label="${label}"]`);
			const title = label.slice("Add ".length, -" podcast".length);
			await waitFor(
				`app.plugins.plugins.podnotes.settings.savedFeeds[args.title]`,
				`${title} to save`,
				{
					title,
				},
			);
		}
		await fill(search, seed.search);
		await waitFor(
			`document.querySelectorAll(".podcast-query-results > *").length >= 4`,
			"search results",
		);
		await settle(2500);
		// The search shares its settings card with the playlists and more, so the
		// shot hides what follows it and the card ends below the results.
		await run(`window.searchSectionRest = [];
			const tab = document.querySelector(".modal.mod-settings .vertical-tab-content");
			const card = (${SEARCH_CARD})(tab);
			for (let node = tab.querySelector(".podcast-query-container"); node !== card; node = node.parentElement)
				for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
					next.style.display = "none";
					searchSectionRest.push(next);
				}
			return true;`);
		await shoot(
			"add-podcast",
			{ kind: "rect", body: SEARCH_SECTION },
			{ css: `${CAPTURE_CSS} ${FIRST_FOUR_RESULTS}` },
		);
		await run(`searchSectionRest.forEach((el) => (el.style.display = "")); return true;`);
		const { playlist } = seed;
		await run(
			`const form = document.querySelector(".modal.mod-settings .add-playlist-container");
			const icon = form.querySelector("select");
			icon.value = args.icon;
			icon.dispatchEvent(new Event("change", { bubbles: true }));
			const name = form.querySelector('input[placeholder="Playlist name"]');
			name.value = args.name;
			name.dispatchEvent(new Event("input", { bubbles: true }));
			return true;`,
			{ icon: playlist.icon, name: playlist.name },
		);
		await click('[aria-label="Add playlist"]');
		await waitFor(
			`app.plugins.plugins.podnotes.settings.playlists[args.name]`,
			"the playlist",
			{
				name: playlist.name,
			},
		);
		await run(`app.setting.close(); return true;`);

		// Play each episode, write its note, and leave the last one playing.
		await run(`app.commands.executeCommandById("podnotes:podnotes-show-leaf"); return true;`);
		await waitFor(
			`document.querySelector(args.selector)?.getClientRects().length`,
			"the PodNotes view",
			{
				selector: PLAYER,
			},
		);
		await run(`app.workspace.rightSplit.setSize(args.size); return true;`, { size: SIDEBAR });
		const notePaths = new Map();
		for (const episode of seed.episodes) {
			await showLatest();
			await fill('.podcast-view input[placeholder="Search episodes"]', episode.title);
			await click(".podcast-view .podcast-episode-item", episode.title);
			await waitFor(`${api}.podcast?.title === args.title`, episode.title, {
				title: episode.title,
			});
			await waitFor(`${api}.length > 0`, `${episode.title} to load`);
			const before = await run(`return app.workspace.getActiveFile()?.path ?? null;`);
			await run(
				`app.commands.executeCommandById("podnotes:create-podcast-note"); return true;`,
			);
			const note = await waitFor(
				`(() => { const p = app.workspace.getActiveFile()?.path; return p && p !== args.before && p.startsWith("PodNotes/") ? p : null; })()`,
				`the note for ${episode.title}`,
				{ before },
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
				`app.workspace.getActiveFile()?.path === args.path`,
				`the feed note for ${podcast}`,
				{
					path: `PodNotes/Podcasts/${podcast}.md`,
				},
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
		const longTitles = await run(
			`return [...document.querySelectorAll(".podcast-view .podcast-episode-row .episode-item-title")]
			.map((el) => el.textContent.trim())
			.filter((title) => title.length > args.max);`,
			{ max: seed.maxTitleLength },
		);
		for (const title of longTitles) {
			await click(
				`.podcast-view [aria-label=${JSON.stringify(`More options for ${title}`)}]`,
			);
			await click(".menu .menu-item", "Remove from Queue");
		}

		const hero = seed.episodes.at(-1);
		await run(
			`const file = app.vault.getAbstractFileByPath(args.path);
			const leaves = [];
			app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));
			await leaves[0].openFile(file);
			for (const leaf of leaves.slice(1)) leaf.detach();
			app.workspace.setActiveLeaf(leaves[0], { focus: false });
			const explorer = app.workspace.getLeavesOfType("file-explorer")[0];
			await explorer.loadIfDeferred?.();
			explorer.view.revealInFolder(file);
			${api}.currentTime = args.at;
			${api}.playbackRate = args.rate;
			if (!${api}.isPlaying) ${api}.start();
			return true;`,
			{ path: notePaths.get(hero), at: hero.playAt, rate: hero.playbackRate },
		);
		await waitFor(`app.workspace.getActiveFile()?.path === args.path`, "the hero note", {
			path: notePaths.get(hero),
		});
		await click('.podcast-view [aria-label^="Player"]');
		await settle(1500);
		const scrollNote = (line) =>
			run(
				`const editor = app.workspace.getLeavesOfType("markdown")[0].view.editor;
				const view = editor.cm;
				const index = [...Array(editor.lineCount()).keys()].find((i) => editor.getLine(i) === args.line) ?? 0;
				view.scrollDOM.scrollTop = args.line ? view.lineBlockAt(view.state.doc.line(index + 1).from).top - 40 : 0;
				return true;`,
				{ line },
			);
		const showProperties = (open) =>
			run(
				`const box = app.workspace.getLeavesOfType("markdown")[0].view.contentEl.querySelector(".metadata-container");
				if (box.classList.contains("is-collapsed") === args.open) box.querySelector(".metadata-properties-heading").click();
				await new Promise((r) => setTimeout(r, 300));
				return true;`,
				{ open },
			);
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
		const heroText = await run(`return app.vault.adapter.read(args.path);`, { path: heroNote });
		for (const theme of ["light", "dark"]) {
			await recordDemo(theme);
			await run(`await app.vault.adapter.write(args.path, args.text); return true;`, {
				path: heroNote,
				text: heroText,
			});
			await settle(800);
		}
		await run(
			`app.workspace.leftSplit.expand(); app.workspace.rightSplit.setSize(args.size); return true;`,
			{ size: SIDEBAR },
		);

		await click('.podcast-view [aria-label="Podcast grid"]');
		await click(`.podcast-view [aria-label=${JSON.stringify(playlist.name)}]`);
		await waitFor(
			`document.querySelectorAll(".podcast-view .podcast-episode-item").length >= args.count`,
			"the playlist episodes",
			{ count: playlist.episodes.length },
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
			body: `const box = document.querySelector('.workspace-leaf-content[data-type="bases"]').getBoundingClientRect();
				const rows = [...document.querySelectorAll('.workspace-leaf-content[data-type="bases"] .bases-tr')];
				const top = rows[0].getBoundingClientRect().top - 12;
				const last = rows.at(-1).getBoundingClientRect();
				const right = Math.max(...rows.flatMap((row) => [...row.children].map((cell) => cell.getBoundingClientRect().right)));
				return { x: box.x, y: top, width: Math.min(box.width, right - box.x + 24), height: last.bottom + 24 - top };`,
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
		await run(`app.workspace.leftSplit.collapse();
			app.workspace.rightSplit.collapse();
			await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath("PodNotes/Episodes.base"));
			return true;`);
		await settle(2000);
		await shoot(
			"bases-phone",
			{
				kind: "rect",
				body: `const box = document.querySelector('.workspace-leaf-content[data-type="bases"]').getBoundingClientRect();
					const rows = [...document.querySelectorAll('.workspace-leaf-content[data-type="bases"] .bases-tr')];
					const top = rows[0].getBoundingClientRect().top - 12;
					const last = rows.at(-1).getBoundingClientRect();
					return { x: box.x, y: top, width: box.width, height: Math.min(innerHeight, last.bottom + 24) - top };`,
			},
			phone,
		);
		await run(
			`await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(args.path)); return true;`,
			{ path: notePaths.get(hero) },
		);
		await settle(1000);
		await showProperties(true);
		await scrollNote("");
		// The properties, artwork, and callout need a taller phone to clear the
		// navigation bar.
		await shoot("episode-note-phone", episodeNote, {
			...phone,
			size: { ...PHONE, height: 932 },
		});
		await showProperties(false);
		await scrollNote("## Notes");
		await shoot("timestamps-phone", notesSection, phone);
		// The landing page's hero on phones: the note with its timestamps.
		await scrollNote("");
		await shoot(
			"hero-phone",
			noteCrop(
				`(lines) => lines.find((el) => el.matches(".inline-title"))`,
				`(lines) => lines.filter((el) => /\\d\\d:\\d\\d:\\d\\d/.test(el.textContent.trim())).at(-1)`,
			),
			phone,
		);
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
				body: `const lines = [...app.workspace.getLeavesOfType("markdown")[0].view.contentEl.querySelectorAll(".cm-line")];
					const top = lines.find((el) => el.textContent.trim() === "Notes").getBoundingClientRect().top - 16;
					return { x: 0, y: top, width: innerWidth, height: innerHeight - top };`,
			},
			{
				css: `${CAPTURE_CSS} .cm-cursorLayer { display: none; } .cm-content { caret-color: transparent !important; }`,
				// A shorter phone keeps the toolbar close under the note's last line.
				size: { ...PHONE, height: 724 },
				clean: false,
			},
		);
		await run(`app.commands.executeCommandById("podnotes:podnotes-show-leaf"); return true;`);
		await settle(2000);
		await click('.podcast-view [aria-label^="Player"]');
		await run(`${api}.currentTime = args.at; ${api}.start(); return true;`, {
			at: hero.playAt,
		});
		await settle(1500);
		await shoot(
			"mobile-player",
			{
				kind: "rect",
				body: `const drawer = document.querySelector(".podcast-view").closest(".workspace-drawer, .workspace-split").getBoundingClientRect();
					const top = document.querySelector('.podcast-view [aria-label="Podcast grid"]').getBoundingClientRect().top - 16;
					const controls = document.querySelector(".podcast-view .controls-container").getBoundingClientRect();
					return { x: drawer.x, y: top, width: drawer.width, height: controls.bottom + 24 - top };`,
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

// The settings card that holds Search Podcasts: the nearest box with a
// background around the search.
const SEARCH_CARD = `(tab) => {
	let card = tab.querySelector(".podcast-query-container");
	while (card.parentElement !== tab && getComputedStyle(card).backgroundColor === "rgba(0, 0, 0, 0)") card = card.parentElement;
	return card;
}`;

// That card, with an even margin around it.
const SEARCH_SECTION = `const tab = document.querySelector(".modal.mod-settings .vertical-tab-content");
	const pane = tab.getBoundingClientRect();
	const box = (${SEARCH_CARD})(tab).getBoundingClientRect();
	const top = Math.max(pane.top, box.top - 16);
	const bottom = Math.min(pane.bottom, box.bottom + 16);
	const left = Math.max(pane.left, box.left - 16);
	const right = Math.min(pane.right, box.right + 16);
	return { x: left, y: top, width: right - left, height: bottom - top };`;

await main();
