import { Notice, TFile } from "obsidian";
import { FilePathTemplateEngine, NoteTemplateEngine } from "./TemplateEngine";
import { Episode } from "./types/Episode";
import { get } from "svelte/store";
import { plugin } from "./store";

export default async function createPodcastNote(
	episode: Episode
): Promise<void> {
	const pluginInstance = get(plugin);

	const filePath = FilePathTemplateEngine(
		pluginInstance.settings.note.path,
		episode
	);

	const filePathDotMd = filePath.endsWith(".md")
		? filePath
		: `${filePath}.md`;

	const content = NoteTemplateEngine(
		pluginInstance.settings.note.template,
		episode
	);

	const createOrGetFile: (
		path: string,
		content: string
	) => Promise<TFile> = async (path: string, content: string) => {
		const file = getPodcastNote(episode);

		if (file) {
			new Notice(
				`Note for "${pluginInstance.api.podcast.title}" already exists`
			);
			return file;
		}

		const foldersInPath = path.split("/").slice(0, -1);
		for (let i = 0; i < foldersInPath.length; i++) {
			const folderPath = foldersInPath.slice(0, i + 1).join("/");
			const folder = app.vault.getAbstractFileByPath(folderPath);

			if (!folder) {
				await app.vault.createFolder(folderPath);
			}
		}

		return await app.vault.create(path, content);
	};

	try {
		const file = await createOrGetFile(filePathDotMd, content);

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

	const filePathDotMd = filePath.endsWith(".md")
		? filePath
		: `${filePath}.md`;
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
