import { MarkdownView, Notice, type MarkdownFileInfo, type WorkspaceLeaf } from "obsidian";
import { TimestampTemplateEngine } from "src/TemplateEngine";
import { createPodcastNoteFileIfNotExists } from "src/createPodcastNote";
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

/** Puts a capture where the user writes: the editor they used last, else the episode note. */
export class CaptureService {
	private activeLeaf: WorkspaceLeaf | null;
	// Clicking in the PodNotes view leaves workspace.activeEditor null.
	private lastEditorLeaf: WorkspaceLeaf | null = null;

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
			new Notice("Set a Capture timestamp format in settings to capture a timestamp.");
			return null;
		}
		const text = render(settings.timestamp.template);
		if (text === null) return null;

		const target = this.editorTarget();
		if (target?.editor) {
			const { editor } = target;
			// replaceSelection lets the editor place the caret, which hand-computed
			// positions get wrong in Live Preview table cells. Inside a table the text is
			// escaped so pipes and newlines don't break the row (#165).
			const inserted = prepareTimestampForInsertion(text, {
				getLine: (line) => editor.getLine(line),
				lineCount: editor.lineCount(),
				cursorLine: editor.getCursor("from").line,
			});
			editor.replaceSelection(inserted);
			return {
				destination: "editor",
				path: target.file?.path ?? "",
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
			await this.plugin.app.vault.process(file, (content) =>
				content.length > 0 && !content.endsWith("\n")
					? `${content}\n${appended}`
					: `${content}${appended}`,
			);
			return { destination: "note", path: file.path, text: appended, created };
		} catch (error) {
			console.error("PodNotes: failed to capture timestamp into episode note", error);
			new Notice("Failed to capture timestamp into episode note");
			return null;
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
