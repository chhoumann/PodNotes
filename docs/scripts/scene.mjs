// What screenshots.mjs and videos.mjs share: the docs' seed plan, the fixture
// library as the docs show it, episode notes made with PodNotes' own commands,
// and the instance's CDP channel.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execObsidian, obsidianCommandArgs, resolveInstanceOptions } from "obsidian-e2e/runner";
import {
	config,
	evaluate,
	provision,
	root,
	waitFor,
} from "../../.claude/skills/verify/screens/instance.mjs";

export const seedDir = fileURLToPath(new URL("../screenshots", import.meta.url));
export const plan = JSON.parse(fs.readFileSync(path.join(seedDir, "seed.json"), "utf8"));
export const instance = resolveInstanceOptions(provision, {}, config, root);
export const API = "app.plugins.plugins.podnotes.api";

/** The instance's own CDP channel, the one the screens tooling emulates through. */
export async function cdp(/** @type {string} */ method, params = {}) {
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

/** @param {Awaited<ReturnType<typeof import("../../.claude/skills/verify/screens/scenes.mjs").library>>} lib @param {string} podcast @param {string} title */
export function episode(lib, podcast, title) {
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
export function docsLibrary(data, lib) {
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

/**
 * Creates the loaded episode's note with Create episode note, fills in its
 * properties, and writes its notes, capturing each `{{at h:mm:ss}}` line with
 * PodNotes' own capture.
 * @param {{ title: string, notes?: string, status: string, rating?: number, rename?: string }} entry
 */
export async function writeNote(entry) {
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
