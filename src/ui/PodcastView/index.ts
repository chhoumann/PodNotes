import { ItemView } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type { IPodNotes } from "../../types/IPodNotes";
import { VIEW_TYPE } from "../../constants";
import PodcastView from "./PodcastView.svelte";

export class MainView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: IPodNotes) {
		super(leaf);
	}

	private podcastView: PodcastView | null = null;

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
		this.podcastView = new PodcastView({
			target: this.contentEl,
		});
	}

	protected override async onClose(): Promise<void> {
		this.podcastView?.$destroy();

		this.contentEl.empty();
	}
}
