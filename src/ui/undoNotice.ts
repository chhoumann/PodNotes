import { Notice } from "obsidian";

/** One per Undo notice still up: it hides the notice and disarms its button. */
const showing = new Set<() => void>();

/** A Notice that ends in an Undo button. Undo runs at most once, and hides the notice. */
export function noticeWithUndo(message: string, undo: () => void): void {
	// Obsidian's Notice takes only a main window fragment, also where it shows in a popout.
	const fragment = createFragment();
	fragment.createSpan({ cls: "pn-undo-message", text: message });
	const button = fragment.createEl("button", { cls: "pn-undo", text: "Undo" });
	const notice = new Notice(fragment, 7000);
	const dismiss = () => {
		showing.delete(dismiss);
		button.removeEventListener("click", run);
		notice.hide();
	};
	const run = () => {
		dismiss();
		undo();
	};
	button.addEventListener("click", run);
	showing.add(dismiss);
	// Obsidian keeps a notice up past its time while the pointer rests on it.
	const forget = () => {
		if (button.isConnected) window.setTimeout(forget, 1000);
		else showing.delete(dismiss);
	};
	window.setTimeout(forget, 7000);
}

/**
 * Hides every Undo notice and disarms its button. An Undo is bound to the plugin
 * instance that offered it, so it must not outlive that instance.
 */
export function dismissUndoNotices(): void {
	for (const dismiss of showing) dismiss();
}
