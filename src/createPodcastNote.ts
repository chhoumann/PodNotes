import { Notice, TFile } from "obsidian";
import { FilePathTemplateEngine, NoteTemplateEngine } from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import { get } from "svelte/store";
import { plugin } from "./store";
import addExtension from "./utility/addExtension";
import { enforceMaxPathLength } from "./utility/enforceMaxPathLength";
import { ensureFolderExists } from "./utility/ensureFolderExists";

/**
 * Resolve the on-disk path of an episode's note from the configured template.
 * Centralized so the existence check, the open action, and creation all agree on
 * the exact same (length-capped) path — otherwise a truncated note would be
 * re-created on every invocation. See issue #22.
 */
function getPodcastNotePath(episode: Episode): string {
	const pluginInstance = get(plugin);

	const filePath = FilePathTemplateEngine(
		pluginInstance.settings.note.path,
		episode,
	);

	return enforceMaxPathLength(addExtension(filePath, "md"));
}

export default async function createPodcastNote(
	episode: Episode
): Promise<void> {
	const pluginInstance = get(plugin);

	const filePathDotMd = getPodcastNotePath(episode);

	const content = NoteTemplateEngine(
		pluginInstance.settings.note.template,
		episode
	);

	try {
		const file = await createFileIfNotExists(
			filePathDotMd,
			content,
			episode
		);

		app.workspace.getLeaf().openFile(file);
	} catch (error) {
		console.error(error);
		new Notice(`Failed to create note: "${filePathDotMd}"`);
	}
}

export function getPodcastNote(episode: Episode): TFile | null {
	const filePathDotMd = getPodcastNotePath(episode);
	const file = app.vault.getAbstractFileByPath(filePathDotMd);

	if (!file || !(file instanceof TFile)) {
		return null;
	}

	return file;
}

export function openPodcastNote(epiosode: Episode): void {
	const file = getPodcastNote(epiosode);

	if (!file) {
		new Notice(`Note for "${epiosode.title}" does not exist`);
		return;
	}

	app.workspace.getLeaf().openFile(file);
}

async function createFileIfNotExists(
	path: string,
	content: string,
	episode: Episode,
): Promise<TFile> {
	const file = getPodcastNote(episode);

	if (file) {
		new Notice(`Note for "${episode.title}" already exists`);

		return file;
	}

	const folderPath = path.split("/").slice(0, -1).join("/");
	await ensureFolderExists(folderPath);

	try {
		return await app.vault.create(path, content);
	} catch (error) {
		// A racing create may have won between the check and here; treat an
		// already-existing file as success rather than surfacing an error.
		const raced = app.vault.getAbstractFileByPath(path);
		if (raced instanceof TFile) {
			return raced;
		}
		throw error;
	}
}
