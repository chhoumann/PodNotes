import { PodcastFeed } from 'src/types/PodcastFeed';
import { IPodNotes } from '../../main';
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../../constants";
import FeedParser from 'src/parser/feedParser';
import PodcastView from './PodcastView.svelte';
import { Episode } from 'src/types/Episode';

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

    private async getPodcast(feed: PodcastFeed): Promise<Episode[]> {
        try {
			const parser = new FeedParser(feed);
            const episodes = (await parser.parse(feed.url));
			return episodes;

			//currentEpisode.set(episode);
        } catch (error) {
			new Notice(error, 5000);
			throw new Error(error);
        }
    }
}
