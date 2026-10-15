import {
	ItemView,
	Platform,
	type App,
	type TFile,
	type Workspace,
	type WorkspaceLeaf,
} from "obsidian";
import { VIEW_TYPE } from "src/constants";

/**
 * Opens a note where Obsidian opens a link, except while the PodNotes view is active in the main
 * area or a popout. There Obsidian would add a tab to the view's tab group, or take a note
 * stacked with the view, and either moves the view out of sight. So the note goes to a note in
 * sight in another tab group of that window, else to a split beside the view, which later notes
 * then reuse. A phone shows one tab at a time anyway.
 */
export async function openNote({ workspace }: App, file: TFile): Promise<void> {
	const view = workspace.getActiveViewOfType(ItemView)?.leaf;
	if (
		view?.view.getViewType() !== VIEW_TYPE ||
		Platform.isPhone ||
		view.getRoot() === workspace.leftSplit ||
		view.getRoot() === workspace.rightSplit
	) {
		await workspace.getLeaf().openFile(file);
		return;
	}
	const leaf = noteBeside(workspace, view) ?? workspace.createLeafBySplit(view);
	await leaf.openFile(file, { active: true });
}

/**
 * The first note in sight in the view's window, which every popout's root is shared across,
 * outside the view's tab group and the sidebars.
 */
function noteBeside(workspace: Workspace, view: WorkspaceLeaf): WorkspaceLeaf | undefined {
	let found: WorkspaceLeaf | undefined;
	workspace.iterateAllLeaves((leaf) => {
		if (
			!found &&
			leaf.parent !== view.parent &&
			leaf.getContainer() === view.getContainer() &&
			leaf.getRoot() === view.getRoot() &&
			leaf.view.navigation &&
			!leaf.getViewState().pinned &&
			leaf.view.containerEl.isShown()
		)
			found = leaf;
	});
	return found;
}
