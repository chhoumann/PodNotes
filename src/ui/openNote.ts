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
 * Opens a note where Obsidian opens a link: in a note in sight, else in a new tab in the active
 * tab group. With the PodNotes view active in the main area, that tab would cover the view, so
 * the note opens in a split beside it, which later notes then reuse. A phone shows one tab at a
 * time anyway.
 */
export async function openNote({ workspace }: App, file: TFile): Promise<void> {
	const view = workspace.getActiveViewOfType(ItemView)?.leaf;
	const covered =
		view?.view.getViewType() === VIEW_TYPE &&
		!Platform.isPhone &&
		view.getRoot() !== workspace.leftSplit &&
		view.getRoot() !== workspace.rightSplit &&
		!noteInSight(workspace, view);
	const leaf = covered ? workspace.createLeafBySplit(view) : workspace.getLeaf();
	await leaf.openFile(file);
}

/**
 * Whether a leaf that getLeaf(false) would open a note in shows beside the view: in its window,
 * which every popout's root is shared across, and outside the sidebars.
 */
function noteInSight(workspace: Workspace, view: WorkspaceLeaf): boolean {
	let found = false;
	workspace.iterateAllLeaves((leaf) => {
		found ||=
			leaf.getContainer() === view.getContainer() &&
			leaf.getRoot() === view.getRoot() &&
			leaf.view.navigation &&
			!leaf.getViewState().pinned &&
			leaf.view.containerEl.isShown();
	});
	return found;
}
