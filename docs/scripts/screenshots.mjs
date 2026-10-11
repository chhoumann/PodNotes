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
const WINDOW = { width: 1440, height: 900 };
const PLAYER = '.workspace-leaf-content[data-type="podcast_player_view"]';
const ROOT = ".workspace-split.mod-root";
// Linux draws scrollbars that macOS hides until you scroll.
const CAPTURE_CSS = "::-webkit-scrollbar { display: none; }";
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
	const { client, stop } = await launch();
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
	async function shoot(name, target, css = CROP_CSS) {
		await fs.mkdir(outDir, { recursive: true });
		for (const theme of ["light", "dark"]) {
			await prepareCapture(client, {
				...WINDOW,
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
				y: WINDOW.height - 80,
			});
			await run(
				`document.querySelectorAll(".has-focus").forEach((el) => el.classList.remove("has-focus")); return true;`,
			);
			await settle(400);
			const png = path.join(profileRoot, `${name}-${theme}.png`);
			await captureScreenshot(client, png, { target, clean: true });
			await sharp(png)
				.webp({ quality: 86 })
				.toFile(path.join(outDir, `${name}${theme === "dark" ? "-dark" : ""}.webp`));
		}
		await prepareCapture(client, { theme: "light", css: CAPTURE_CSS });
	}

	/** A crop of `selector` from its top to the bottom of its `count`th visible `item`. */
	const cropTo = (selector, item, count, pad = 16) => ({
		kind: "rect",
		expression: `(() => {
			const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
			const items = [...document.querySelectorAll(${JSON.stringify(`${selector} ${item}`)})].filter((el) => el.getClientRects().length > 0);
			const bottom = Math.min(items[${count - 1}].getBoundingClientRect().bottom + ${pad}, box.bottom);
			return { x: box.x, y: box.y, width: box.width, height: bottom - box.y };
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
		await shoot("add-podcast", { kind: "rect", expression: SEARCH_SECTION }, CAPTURE_CSS);
		await run(`app.setting.close(); return true;`);

		// Play each episode, write its note, and leave the last one playing.
		await run(`app.commands.executeCommandById("podnotes:podnotes-show-leaf"); return true;`);
		await waitFor(
			`document.querySelector(${JSON.stringify(PLAYER)})?.getClientRects().length`,
			"the PodNotes view",
		);
		await run(`app.workspace.rightSplit.setSize(380); return true;`);
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

		const hero = seed.episodes.at(-1);
		await run(`const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePaths.get(hero))});
			const leaves = [];
			app.workspace.iterateRootLeaves((leaf) => leaves.push(leaf));
			await leaves[0].openFile(file);
			for (const leaf of leaves.slice(1)) leaf.detach();
			app.workspace.setActiveLeaf(leaves[0], { focus: false });
			app.workspace.getLeavesOfType("file-explorer")[0].view.revealInFolder(file);
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
		await shoot("hero", { kind: "viewport" }, CAPTURE_CSS);
		// The social preview: the top of the light hero at 1200x630.
		await sharp(path.join(profileRoot, "hero-light.png"))
			.resize(1200, 630, { fit: "cover", position: "top" })
			.png({ compressionLevel: 9, palette: true })
			.toFile(path.join(outDir, "og.png"));
		await shoot("episode-note", { kind: "selector", selector: ROOT });
		await shoot("player", cropTo(PLAYER, ".podcast-episode-item", 1));

		await showLatest();
		await fill('.podcast-view input[placeholder="Search episodes"]', "");
		await settle(1500);
		await shoot("episode-list", cropTo(PLAYER, ".podcast-episode-item", 5, 12));
		await click('.podcast-view [aria-label="Podcast grid"]');
		await settle(1500);
		await shoot("podcast-grid", cropTo(PLAYER, ".pn_image_container", 4));

		await run(`app.workspace.leftSplit.collapse();
			app.workspace.rightSplit.collapse();
			await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath("PodNotes/Episodes.base"));
			return true;`);
		await settle(2000);
		await shoot(
			"bases",
			cropTo(
				'.workspace-leaf-content[data-type="bases"]',
				".bases-tr",
				seed.episodes.length,
				32,
			),
		);
		console.log(`Wrote screenshots to ${path.relative(repoDir, outDir)}`);
	} finally {
		client.close();
		stop();
	}
}

// The Search Podcasts heading and the first two rows of results.
const SEARCH_SECTION = `(() => {
	const tab = document.querySelector(".modal.mod-settings .vertical-tab-content");
	const name = [...tab.querySelectorAll(".setting-item-heading .setting-item-name")].find((n) => n.textContent.trim() === "Search Podcasts");
	const top = name.closest(".setting-item").getBoundingClientRect().y - 8;
	const container = tab.querySelector(".podcast-query-container").getBoundingClientRect();
	const rows = [...tab.querySelectorAll(".podcast-query-results > *")].slice(0, 4).map((el) => el.getBoundingClientRect());
	const bottom = Math.max(...rows.map((r) => r.bottom)) + 24;
	return { x: container.x - 24, y: top, width: container.width + 48, height: bottom - top };
})()`;

await main();
