import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { IPodNotes } from "../../types/IPodNotes";
import { VIEW_TYPE } from "../../constants";
import PodcastView from "./PodcastView.svelte";
import { mount, unmount } from "svelte";

export class MainView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: IPodNotes) {
		super(leaf);
	}

	private podcastView: Record<string, unknown> | null = null;

	override getViewType(): string {
		return VIEW_TYPE;
	}

	override getDisplayText(): string {
		return "Podcast Player";
	}

	override getIcon(): string {
		return "play-circle";
	}

	protected override async onOpen(): Promise<void> {
		this.podcastView = mount(PodcastView, {
			target: this.contentEl,
		});
	}

	protected override async onClose(): Promise<void> {
		if (this.podcastView) {
			await unmount(this.podcastView);
			this.podcastView = null;
		}

		this.contentEl.empty();
	}
}
