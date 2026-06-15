import { type App, Modal } from "obsidian";
import { mount, unmount } from "svelte";
import ReorderQueue from "./ReorderQueue.svelte";

/**
 * A focused modal for resequencing the playback queue. The episode list lives in
 * the frozen Player UI, so this provides the only full-list reorder surface —
 * with per-row move buttons that work identically on desktop and mobile.
 */
export class QueueReorderModal extends Modal {
	private component: Record<string, unknown> | null = null;

	constructor(app: App) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText("Reorder Queue");
		this.component = mount(ReorderQueue, {
			target: this.contentEl,
			props: {
				close: () => this.close(),
			},
		});
	}

	override onClose(): void {
		if (this.component) {
			unmount(this.component);
			this.component = null;
		}

		this.contentEl.empty();
	}
}
