import { Notice, TFile } from "obsidian";
import { FilePathTemplateEngine, NoteTemplateEngine } from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import { get } from "svelte/store";
import { plugin } from "./store";
import addExtension from "./utility/addExtension";

export default async function createPodcastNote(
	episode: Episode
): Promise<void> {
	const pluginInstance = get(plugin);

	const filePath = FilePathTemplateEngine(
		pluginInstance.settings.note.path,
		episode
	);

	const filePathDotMd = addExtension(filePath, "md");

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
	const pluginInstance = get(plugin);

	const filePath = FilePathTemplateEngine(
		pluginInstance.settings.note.path,
		episode
	);

	const filePathDotMd = addExtension(filePath, "md");
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
	createFolder = true
): Promise<TFile> {
	const file = getPodcastNote(episode);

	if (file) {
		new Notice(`Note for "${episode.title}" already exists`);

		return file;
	}

	const foldersInPath = path.split("/").slice(0, -1);
	for (let i = 0; i < foldersInPath.length; i++) {
		const folderPath = foldersInPath.slice(0, i + 1).join("/");
		const folder = app.vault.getAbstractFileByPath(folderPath);

		if (!folder && createFolder) {
			await app.vault.createFolder(folderPath);
		}
	}

	return await app.vault.create(path, content);
}
