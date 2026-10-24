import {
	MarkdownView,
	Notice,
	type Editor,
	type EditorSelection,
	type MarkdownFileInfo,
	type TFile,
	type WorkspaceLeaf,
} from "obsidian";
import { findQuickAdd, MISSING_CHOICE } from "src/quickAdd";
import { resolveEpisodeUrl, TimestampTemplateEngine } from "src/TemplateEngine";
import { createPodcastNoteFileIfNotExists, getPodcastNotePath } from "src/createPodcastNote";
import { withoutPrivateFeedAddresses } from "src/services/privateFeeds";
import type { Episode } from "src/types/Episode";
import { noticeWithUndo } from "src/ui/undoNotice";
import { episodeTimestampLink } from "src/utility/formatEpisodeTimestamp";
import { formatDuration } from "src/utility/formatDuration";
import { prepareTimestampForInsertion } from "src/utility/prepareTimestampInsertion";
import { createRecentPodcastSegment, getSegmentCaptureTemplate } from "src/utility/podcastSegment";
import type PodNotes from "src/main";

export interface Capture {
	destination: "editor" | "note";
	/** Vault path of the note the text went into. */
	path: string;
	/** The captured text as the note stores it. */
	text: string;
	/** The episode note did not exist and was created for this capture. */
	created: boolean;
}

/** A capture's text and the position it marks: a moment, or a segment's range. */
interface Rendered {
	readonly text: string;
	readonly start: number;
	readonly end?: number;
}

/**
 * What a QuickAdd choice reads about a capture, as {{VALUE:<name>}}. Values are plain text,
 * not escaped for a note body as note templates are, since a choice can also put them in a
 * path or a property.
 */
export type QuickAddVariables = Record<
	"timestamp" | "time" | "seconds" | "link" | "episode" | "podcast" | "url" | "episodeNote",
	string
>;

export function quickAddVariables(
	episode: Episode,
	{ text, start, end }: Rendered,
): QuickAddVariables {
	const variables: QuickAddVariables = {
		timestamp: text,
		time:
			end === undefined
				? formatDuration(start)
				: `${formatDuration(start)}-${formatDuration(end)}`,
		seconds: String(Math.floor(start)),
		link: episodeTimestampLink(episode, start, end),
		episode: episode.title,
		podcast: episode.podcastName,
		url: resolveEpisodeUrl(withoutPrivateFeedAddresses(episode)),
		episodeNote: getPodcastNotePath(episode),
	};
	// The episode names its feed's address, so redaction finds it even when no saved feed does.
	return withoutPrivateFeedAddresses([variables, episode] as const)[0];
}

/** A note's text as a capture found it and as it left it, and the caret it found in its editor. */
interface Snapshot {
	readonly before: string;
	readonly after: string;
	readonly caret?: { readonly editor: Editor; readonly selections: EditorSelection[] };
}

/** Puts a capture where the user writes: the editor they used last, else the episode note. */
export class CaptureService {
	private activeLeaf: WorkspaceLeaf | null;
	// Clicking in the PodNotes view leaves workspace.activeEditor null.
	private lastEditorLeaf: WorkspaceLeaf | null = null;
	private disposed = false;

	constructor(private readonly plugin: PodNotes) {
		const { workspace } = plugin.app;
		this.activeLeaf = workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null;
		plugin.registerEvent(
			workspace.on("active-leaf-change", (leaf) => {
				// Switching a note between Reading view and editing fires no workspace event,
				// so a note counts by the mode it has when focus leaves it.
				if (this.editingView(this.activeLeaf)) this.lastEditorLeaf = this.activeLeaf;
				this.activeLeaf = leaf;
			}),
		);
		plugin.registerEvent(
			workspace.on("layout-change", () => {
				if (!this.editingView(this.lastEditorLeaf)) this.lastEditorLeaf = null;
			}),
		);
	}

	/** An Undo is bound to the plugin instance, so a capture that ends after unload offers none. */
	dispose(): void {
		this.disposed = true;
	}

	timestamp(): Promise<Capture | null> {
		const { api, settings } = this.plugin;
		return this.capture((template) => ({
			text: TimestampTemplateEngine(template),
			start: Math.max(0, api.currentTime - (settings.timestamp.offset ?? 0)),
		}));
	}

	segment(seconds: number): Promise<Capture | null> {
		return this.capture((template) => {
			const segment = createRecentPodcastSegment(
				this.plugin.api.currentTime,
				seconds,
				this.plugin.settings.timestamp.offset ?? 0,
			);
			if (!segment) {
				new Notice("Play more of the episode before capturing a segment");
				return null;
			}
			return {
				text: TimestampTemplateEngine(getSegmentCaptureTemplate(template), { segment }),
				start: segment.startTime,
				end: segment.endTime,
			};
		});
	}

	private async capture(render: (template: string) => Rendered | null): Promise<Capture | null> {
		const { api, settings } = this.plugin;
		const episode = api.podcast;
		if (!episode) {
			new Notice("Play an episode to capture");
			return null;
		}
		if (!settings.timestamp.template) {
			new Notice("Set a Timestamp template in settings to capture a timestamp.");
			return null;
		}
		const rendered = render(settings.timestamp.template);
		if (rendered === null) return null;
		const choiceId = settings.timestamp.quickAddChoiceId;
		if (choiceId) {
			await this.runQuickAdd(choiceId, quickAddVariables(episode, rendered));
			return null;
		}
		const { text } = rendered;

		const target = this.editorTarget();
		if (target?.editor) {
			const { editor, file } = target;
			const inserted = prepareTimestampForInsertion(text, {
				getLine: (line) => editor.getLine(line),
				lineCount: editor.lineCount(),
				cursorLine: editor.getCursor("from").line,
			});
			const before = editor.getValue();
			const caret = { editor, selections: editor.listSelections() };
			endDetachedTableCell(editor);
			const cell = tableCellWriter(editor);
			if (cell) cell(inserted);
			else editor.replaceSelection(inserted);
			const snapshot = { before, after: editor.getValue(), caret };
			// Outside a note's own view, as in a canvas card, the editor's text need not be
			// its file's, so only that editor can take the capture back.
			const undo =
				target instanceof MarkdownView && file
					? () => this.revert(file, snapshot)
					: () =>
							target.editor === editor &&
							target.file === file &&
							revertIn(editor, snapshot);
			this.offer(file, false, undo);
			return {
				destination: "editor",
				path: file?.path ?? "",
				text: inserted,
				created: false,
			};
		}

		if (!settings.note.path || !settings.note.template) {
			new Notice("Set an episode note path and template to capture timestamps");
			return null;
		}
		try {
			const { file, created } = await createPodcastNoteFileIfNotExists(episode);
			const appended = text.endsWith("\n") ? text : `${text}\n`;
			let before = "";
			const after = await this.plugin.app.vault.process(file, (content) => {
				before = content;
				return content.length > 0 && !content.endsWith("\n")
					? `${content}\n${appended}`
					: `${content}${appended}`;
			});
			this.offer(file, created, () => this.revert(file, { before, after }));
			return { destination: "note", path: file.path, text: appended, created };
		} catch (error) {
			console.error("PodNotes: failed to capture timestamp into episode note", error);
			new Notice("Failed to capture timestamp into episode note");
			return null;
		}
	}

	/** Runs the QuickAdd choice. When QuickAdd can't, one notice names the fix and nothing is written. */
	private async runQuickAdd(id: string, variables: QuickAddVariables): Promise<void> {
		const quickAdd = findQuickAdd(this.plugin.app);
		if ("fix" in quickAdd) {
			new Notice(`${quickAdd.fix} QuickAdd to capture with a QuickAdd choice`);
			return;
		}
		if (!quickAdd.api.getChoice({ id })) {
			new Notice(MISSING_CHOICE);
			return;
		}
		try {
			await quickAdd.api.executeChoice({ id }, variables);
		} catch (error) {
			console.error("PodNotes: the QuickAdd choice failed", error);
		}
	}

	/**
	 * Says where the capture went, with an Undo that takes it back. `undo` returns false,
	 * leaving the note as it is, unless the note is still exactly as the capture left it.
	 */
	private offer(file: TFile | null, created: boolean, undo: () => boolean | Promise<boolean>) {
		if (this.disposed) return;
		const name = file?.basename;
		noticeWithUndo(
			created ? `Created ${name}` : name ? `Timestamp added to ${name}` : "Timestamp added",
			async () => {
				if (!(await undo())) {
					new Notice("The note isn't as the capture left it, so the timestamp stays");
				}
			},
		);
	}

	/** Puts the note back as the capture found it, while it is exactly as the capture left it. */
	private async revert(file: TFile, snapshot: Snapshot): Promise<boolean> {
		// An open editor's buffer is the note: a vault write behind it could lose what it
		// has not saved yet. Obsidian saves a note as it leaves editing, so once that save
		// lands, a closed tab or one in Reading view leaves the file as the note.
		// Every open editor of the note has to hold the text as the capture left it.
		const editing = this.plugin.app.workspace.getLeavesOfType("markdown").flatMap((leaf) => {
			const view = this.editingView(leaf);
			return view?.file === file ? [view] : [];
		});
		const [first] = editing;
		if (first) {
			return (
				editing.every((view) => view.editor.getValue() === snapshot.after) &&
				revertIn(first.editor, snapshot)
			);
		}
		try {
			await this.plugin.app.vault.process(file, (content) => {
				if (content !== snapshot.after) throw new Error("The note changed");
				return snapshot.before;
			});
			return true;
		} catch {
			return false;
		}
	}

	/** The focused editor, which covers canvas and embedded editors, else the one used last. */
	private editorTarget(): MarkdownFileInfo | null {
		const active = this.plugin.app.workspace.activeEditor;
		// A note in Reading view keeps its hidden editor, where written text is lost.
		const reading = active instanceof MarkdownView && active.getMode() === "preview";
		// Obsidian clears activeEditor before its deferred active-leaf-change event.
		return active?.editor && !reading
			? active
			: (this.editingView(this.activeLeaf) ?? this.editingView(this.lastEditorLeaf));
	}

	/** The leaf's note while it is open in Source or Live Preview mode. */
	private editingView(leaf: WorkspaceLeaf | null): MarkdownView | null {
		const open = leaf && this.plugin.app.workspace.getLeavesOfType("markdown").includes(leaf);
		return open && leaf.view instanceof MarkdownView && leaf.view.getMode() === "source"
			? leaf.view
			: null;
	}
}

/** Puts back only the stretch the capture changed, so the editor's own undo history stays. */
function revertIn(editor: Editor, { before, after, caret }: Snapshot): boolean {
	if (editor.getValue() !== after) return false;
	endDetachedTableCell(editor);
	let from = 0;
	while (from < before.length && before[from] === after[from]) from++;
	let tail = 0;
	while (
		tail < Math.min(before.length, after.length) - from &&
		before[before.length - 1 - tail] === after[after.length - 1 - tail]
	) {
		tail++;
	}
	// Obsidian holds back an edit that falls inside the table cell being edited and
	// hands it to the cell's editor later, remapped against its decoded text.
	// Starting before the cell bypasses that remap without moving the edit's end.
	if (tableCellWriter(editor)) {
		from = after.slice(0, from).lastIndexOf("\n") + 1;
	}
	editor.replaceRange(
		before.slice(from, before.length - tail),
		editor.offsetToPos(from),
		editor.offsetToPos(after.length - tail),
	);
	// When Obsidian padded the table around the cell, the stretch holds the caret, and the
	// edit moves it to the stretch's start, before the table.
	if (caret?.editor === editor) editor.setSelections(caret.selections);
	return true;
}

/**
 * Writes table cell text where Live Preview edits it: the cell has an editor of its own,
 * outside Obsidian's API, that the note's editor reaches only late and remapped. The
 * cell's editor shows a pipe unescaped and Obsidian escapes it again as it writes the
 * cell to the note.
 */
function tableCellWriter(editor: Editor): ((escaped: string) => void) | null {
	const cell = field(field(field(editor, "editorComponent"), "tableCell"), "editor");
	const replaceSelection = field(cell, "replaceSelection");
	return typeof replaceSelection === "function"
		? (escaped) => replaceSelection.call(cell, escaped.replace(/\\\|/g, "|"))
		: null;
}

/**
 * Obsidian keeps a table cell's editor once its table leaves the note's view, as in Source
 * mode or after the tab showed another note. That cell rewrites the table from its old copy
 * at its old place, and takes over the note editor's edits there, so it is ended as Obsidian
 * ends it when the note's editor takes focus.
 */
function endDetachedTableCell(editor: Editor): void {
	const component = field(editor, "editorComponent");
	const cell = field(component, "tableCell");
	const end = field(component, "destroyTableCell");
	if (cell && !field(field(cell, "containerEl"), "isConnected") && typeof end === "function") {
		end.call(component);
	}
}

function field(value: unknown, key: string): unknown {
	return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}
