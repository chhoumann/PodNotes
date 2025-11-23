import type { IPodNotes } from "../../types/IPodNotes";
import { ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../../constants";
import PodcastView from './PodcastView.svelte';

export class MainView extends ItemView {
    constructor(leaf: WorkspaceLeaf, private plugin: IPodNotes) {
        super(leaf);
    }

    private PodcastView: PodcastView;

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Podcast Player";
    }

    getIcon(): string {
        return "play-circle";
    }

    protected async onOpen(): Promise<void> {
        this.PodcastView = new PodcastView({
            target: this.contentEl,
        })
    }

    protected async onClose(): Promise<void> {
        this.PodcastView?.$destroy();

        this.contentEl.empty();
    }
}
