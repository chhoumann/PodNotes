import type { Workspace } from "obsidian";

/**
 * Removes the style sheets an earlier PodNotes bundle injected. Obsidian updates a plugin
 * without reloading its windows, and Svelte only appends a component's sheet, so an old
 * sheet would keep applying until a restart. Popouts are swept too: Obsidian mirrors the
 * main window's sheets into them but never removes one Svelte appended there directly.
 */
export function removePreviousStyles(workspace: Workspace): void {
	const docs = new Set([window.document]);
	workspace.iterateAllLeaves((leaf) => docs.add(leaf.getContainer().doc));
	for (const doc of docs) {
		for (const style of doc.head.querySelectorAll('style[id^="pn-"]')) style.remove();
	}
}
