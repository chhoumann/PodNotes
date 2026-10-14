import {
	MarkdownView,
	Notice,
	type Editor,
	type MarkdownFileInfo,
	type TFile,
	type WorkspaceLeaf,
} from "obsidian";
import { TimestampTemplateEngine } from "src/TemplateEngine";
import { createPodcastNoteFileIfNotExists } from "src/createPodcastNote";
import { noticeWithUndo } from "src/ui/undoNotice";
import { prepareTimestampForInsertion } from "src/utility/prepareTimestampInsertion";
import { createRecentPodcastSegment, getSegmentCaptureTemplate } from "src/utility/podcastSegment";
import type PodNotes from "src/main";

export interface Capture {
	destination: "editor" | "note";
	/** Vault path of the note the text went into. */
	path: string;
	/** The text as inserted. */
	text: string;
	/** The episode note did not exist and was created for this capture. */
	created: boolean;
}

/** A note's text as a capture found it and as it left it. */
interface Snapshot {
	readonly before: string;
	readonly after: string;
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
		return this.capture((template) => TimestampTemplateEngine(template));
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
			return TimestampTemplateEngine(getSegmentCaptureTemplate(template), { segment });
		});
	}

	private async capture(render: (template: string) => string | null): Promise<Capture | null> {
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
		const text = render(settings.timestamp.template);
		if (text === null) return null;

		const target = this.editorTarget();
		if (target?.editor) {
			const { editor, file } = target;
			// replaceSelection lets the editor place the caret, which hand-computed
			// positions get wrong in Live Preview table cells. Inside a table the text is
			// escaped so pipes and newlines don't break the row (#165).
			const inserted = prepareTimestampForInsertion(text, {
				getLine: (line) => editor.getLine(line),
				lineCount: editor.lineCount(),
				cursorLine: editor.getCursor("from").line,
			});
			const before = editor.getValue();
			editor.replaceSelection(inserted);
			const snapshot = { before, after: editor.getValue() };
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
		return active?.editor && !reading ? active : this.editingView(this.lastEditorLeaf);
	}

	/** The leaf's note while it is open in Source or Live Preview mode. */
	private editingView(leaf: WorkspaceLeaf | null): MarkdownView | null {
		const open = leaf && this.plugin.app.workspace.getLeavesOfType("markdown").includes(leaf);
		return open && leaf.view instanceof MarkdownView && leaf.view.getMode() === "source"
			? leaf.view
			: null;
	}
}

/**
 * Puts back only the stretch the capture changed, so the caret and the editor's own
 * undo history stay.
 */
function revertIn(editor: Editor, { before, after }: Snapshot): boolean {
	if (editor.getValue() !== after) return false;
	let from = 0;
	while (from < before.length && before[from] === after[from]) from++;
	let tail = 0;
	while (
		tail < Math.min(before.length, after.length) - from &&
		before[before.length - 1 - tail] === after[after.length - 1 - tail]
	) {
		tail++;
	}
	editor.replaceRange(
		before.slice(from, before.length - tail),
		editor.offsetToPos(from),
		editor.offsetToPos(after.length - tail),
	);
	return true;
}
