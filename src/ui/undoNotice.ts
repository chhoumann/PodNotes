import { Notice } from "obsidian";

/** A Notice that ends in an Undo button. Undo runs at most once, and hides the notice. */
export function noticeWithUndo(message: string, undo: () => void): void {
	const fragment = activeDocument.createDocumentFragment();
	const button = fragment.createEl("button", { cls: "pn-undo", text: "Undo" });
	fragment.prepend(message);
	const notice = new Notice(fragment, 7000);
	button.addEventListener(
		"click",
		() => {
			notice.hide();
			undo();
		},
		{ once: true },
	);
}
