import { Notice, TFile } from "obsidian";
import {
	FilePathTemplateEngine,
	legacyReplaceIllegalFileNameCharactersInString,
	NoteTemplateEngine,
	templateHasTag,
} from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import type { Chapter } from "./types/Chapter";
import { get } from "svelte/store";
import { plugin } from "./store";
import addExtension from "./utility/addExtension";
import { enforceMaxPathLength } from "./utility/enforceMaxPathLength";
import { ensureFolderExists } from "./utility/ensureFolderExists";
import { fetchChapters } from "./utility/fetchChapters";
import { findUniqueTitleMatch } from "./utility/episodeTitleMatch";

/**
 * Resolve the on-disk path of an episode's note from the configured template.
 * Centralized so the existence check, the open action, and creation all agree on
 * the exact same (length-capped) path — otherwise a truncated note would be
 * re-created on every invocation. See issue #22.
 */
export function getPodcastNotePath(episode: Episode): string {
	return renderPodcastNotePath(get(plugin).settings.note.path, episode);
}

function renderPodcastNotePath(
	template: string,
	episode: Episode,
	sanitizeFileName?: (value: string) => string,
): string {
	return enforceMaxPathLength(
		addExtension(FilePathTemplateEngine(template, episode, sanitizeFileName), "md"),
	);
}

function getPodcastNotePathCandidates(episode: Episode): string[] {
	const template = get(plugin).settings.note.path;
	return [
		...new Set([
			renderPodcastNotePath(template, episode),
			renderPodcastNotePath(
				template,
				episode,
				legacyReplaceIllegalFileNameCharactersInString,
			),
		]),
	];
}

function parentFolder(path: string): string {
	const separator = path.lastIndexOf("/");
	return separator === -1 ? "" : path.slice(0, separator);
}

function noteBasename(path: string): string {
	return (path.split("/").pop() ?? "").replace(/\.md$/i, "");
}

export default async function createPodcastNote(episode: Episode): Promise<void> {
	try {
		const file = await createPodcastNoteFileIfNotExists(episode);

		void get(plugin).app.workspace.getLeaf().openFile(file);
	} catch (error) {
		console.error(error);
		new Notice(`Failed to create note: "${getPodcastNotePath(episode)}"`);
	}
}

export async function createPodcastNoteFileIfNotExists(episode: Episode): Promise<TFile> {
	const existingFile = getPodcastNote(episode);
	if (existingFile) {
		new Notice(`Note for "${episode.title}" already exists`);
		return existingFile;
	}

	const pluginInstance = get(plugin);
	const filePathDotMd = getPodcastNotePath(episode);
	const template = pluginInstance.settings.note.template;
	const chapters = await getTemplateChapters(template, episode);
	const content = NoteTemplateEngine(template, episode, { chapters });

	return await createFileIfNotExists(filePathDotMd, content, episode);
}

async function getTemplateChapters(
	template: string,
	episode: Episode,
): Promise<Chapter[] | undefined> {
	if (!episode.chaptersUrl || !templateHasTag(template, "chapters")) {
		return undefined;
	}

	return await fetchChapters(episode.chaptersUrl);
}

export function getPodcastNote(episode: Episode): TFile | null {
	const { vault } = get(plugin).app;

	for (const filePath of getPodcastNotePathCandidates(episode)) {
		const file = vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			return file;
		}
	}

	return findPodcastNoteByTitleOverlap(episode);
}

function findPodcastNoteByTitleOverlap(episode: Episode): TFile | null {
	const { vault } = get(plugin).app;
	if (typeof vault.getMarkdownFiles !== "function") {
		return null;
	}

	const expectedPath = getPodcastNotePath(episode);
	const folder = parentFolder(expectedPath);
	const siblings = vault
		.getMarkdownFiles()
		.filter((file) => parentFolder(file.path) === folder && file instanceof TFile);

	return (
		findUniqueTitleMatch([noteBasename(expectedPath)], siblings, (file) =>
			noteBasename(file.path),
		) ?? null
	);
}

export function openPodcastNote(epiosode: Episode): void {
	const file = getPodcastNote(epiosode);

	if (!file) {
		new Notice(`Note for "${epiosode.title}" does not exist`);
		return;
	}

	void get(plugin).app.workspace.getLeaf().openFile(file);
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

	const { app } = get(plugin);
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
