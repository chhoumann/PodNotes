import { Notice, TFile, TFolder } from "obsidian";
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
import { createFileIfNotExists } from "./utility/createFileIfNotExists";
import { fetchChapters } from "./utility/fetchChapters";
import { findUniqueTitleMatch } from "./utility/episodeTitleMatch";
import { findByGuid } from "./utility/findByGuid";
import { addFrontmatterFields } from "./utility/noteFrontmatter";
import { vaultSafeLinkTarget } from "./services/privateFeeds";
import { openNote } from "./ui/openNote";

/**
 * Resolve the on-disk path of an episode's note from the configured template.
 * Centralized so the existence check, the open action, and creation all agree on
 * the exact same (length-capped) path, otherwise a truncated note would be
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

function getPodcastNoteTitleCandidates(episode: Episode): string[] {
	return [
		...new Set([
			FilePathTemplateEngine("{{title}}", episode),
			FilePathTemplateEngine(
				"{{title}}",
				episode,
				legacyReplaceIllegalFileNameCharactersInString,
			),
		]),
	];
}

export default async function createPodcastNote(episode: Episode): Promise<void> {
	try {
		const { file, created } = await createPodcastNoteFileIfNotExists(episode);
		if (!created) new Notice(`Note for "${episode.title}" already exists`);

		void openNote(get(plugin).app, file);
	} catch (error) {
		console.error(error);
		new Notice(`Failed to create note: "${getPodcastNotePath(episode)}"`);
	}
}

export async function createPodcastNoteFileIfNotExists(
	episode: Episode,
): Promise<{ file: TFile; created: boolean }> {
	const existingFile = getPodcastNote(episode);
	if (existingFile) return { file: existingFile, created: false };

	const pluginInstance = get(plugin);
	const filePathDotMd = getPodcastNotePath(episode);
	const template = pluginInstance.settings.note.template;
	const chapters = await getTemplateChapters(template, episode);
	// Sync can write the note while the chapters load.
	const arrivedFile = chapters && getPodcastNote(episode);
	if (arrivedFile) return { file: arrivedFile, created: false };

	const content = NoteTemplateEngine(template, episode, { chapters });
	const feedUrl = vaultSafeLinkTarget(episode, episode.feedUrl);
	const identified =
		episode.guid && feedUrl
			? addFrontmatterFields(content, [
					["guid", episode.guid],
					["feedUrl", feedUrl],
				])
			: content;

	return createFileIfNotExists(filePathDotMd, identified);
}

async function getTemplateChapters(
	template: string,
	episode: Episode,
): Promise<Chapter[] | undefined> {
	if (!templateHasTag(template, "chapters")) return undefined;
	return (await fetchChapters(episode)) ?? [];
}

export function getPodcastNote(episode: Episode): TFile | null {
	return findExactPodcastNote(episode) ?? findPodcastNoteByTitleOverlap(episode);
}

/**
 * The note with the episode's guid, else the one at a path the template renders. It
 * skips the title-overlap scan of the notes folder, so a list can ask for every row.
 */
export function findExactPodcastNote(episode: Episode): TFile | null {
	const { vault } = get(plugin).app;

	const identified = findPodcastNoteByGuid(episode);
	if (identified) return identified;

	for (const filePath of getPodcastNotePathCandidates(episode)) {
		const file = vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			return file;
		}
	}

	return null;
}

interface IdentifiedNote {
	file: TFile;
	guid: string;
	feedUrl: unknown;
}

let identifiedNotes: IdentifiedNote[] | undefined;

// An episode list asks for every row's note at once, so the vault is read once per
// task, not once per episode. The next task reads it again, so it sees new notes.
function notesWithGuid(): IdentifiedNote[] {
	if (!identifiedNotes) {
		const { vault, metadataCache } = get(plugin).app;
		identifiedNotes = vault.getMarkdownFiles().flatMap((file) => {
			const frontmatter = metadataCache.getFileCache(file)?.frontmatter;
			return typeof frontmatter?.guid === "string"
				? [{ file, guid: frontmatter.guid, feedUrl: frontmatter.feedUrl }]
				: [];
		});
		queueMicrotask(() => (identifiedNotes = undefined));
	}
	return identifiedNotes;
}

function findPodcastNoteByGuid({ guid, feedUrl }: Episode): TFile | undefined {
	if (!guid || !feedUrl) return undefined;
	return findByGuid(
		notesWithGuid().filter((note) => note.feedUrl === feedUrl),
		guid,
	)?.file;
}

function findPodcastNoteByTitleOverlap(episode: Episode): TFile | null {
	const { vault } = get(plugin).app;
	const expectedPath = getPodcastNotePath(episode);
	const folderPath = parentFolder(expectedPath);
	const folder = folderPath ? vault.getAbstractFileByPath(folderPath) : vault.getRoot();
	if (!(folder instanceof TFolder)) return null;

	const siblings = folder.children.filter(
		(file): file is TFile => file instanceof TFile && file.extension === "md",
	);

	return (
		findUniqueTitleMatch(getPodcastNoteTitleCandidates(episode), siblings, (file) =>
			noteBasename(file.path),
		) ?? null
	);
}

export function openPodcastNote(episode: Episode): void {
	const file = getPodcastNote(episode);

	if (!file) {
		new Notice(`Note for "${episode.title}" does not exist`);
		return;
	}

	void openNote(get(plugin).app, file);
}
