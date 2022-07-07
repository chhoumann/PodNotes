import { PodcastFeed } from 'src/types/PodcastFeed';
import { IPodNotes } from '../../main';
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
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
        return "dice";
    }

    protected async onOpen(): Promise<void> {
		this.render();
    }

    protected async onClose(): Promise<void> {
		this.PodcastView?.$destroy();

        this.contentEl.empty();    
    }

    private render() {
        const savedFeeds: PodcastFeed[] = Object.values(this.plugin.settings.savedFeeds);

		this.PodcastView = new PodcastView({
			target: this.contentEl,
			props: {
				feeds: savedFeeds,
			}
		})
    }
}
