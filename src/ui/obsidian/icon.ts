import { setIcon } from "obsidian";
import type { Attachment } from "svelte/attachments";
import type { IconType } from "src/types/IconType";

/** Draws a Lucide icon into the element, so a runes component keeps its own button. */
export function icon(name: IconType): Attachment<HTMLElement> {
	return (el) => {
		setIcon(el, name);
	};
}
