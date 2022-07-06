import { PodcastFeed } from 'src/types/PodcastFeed';
import { IPodNotes } from '../../main';
import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../../constants";
import FeedParser from 'src/parser/feedParser';
import FeedGrid from './FeedGrid.svelte';
import EpisodePlayer from './EpisodePlayer.svelte';
import { Episode } from 'src/types/Episode';
import { currentEpisode } from 'src/store';
import { Unsubscriber } from 'svelte/store';

export class PodcastView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: IPodNotes) {
		super(leaf);
	}   

    private FeedGrid: FeedGrid;
    private EpisodePlayer: EpisodePlayer;

	private episode: Episode;
	private unsubscribeEpisode: Unsubscriber;

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
		this.unsubscribeEpisode = currentEpisode.subscribe((episode: Episode) => {
			this.episode = episode;
			this.render();
		});
    }

    protected async onClose(): Promise<void> {
        this.FeedGrid?.$destroy();
        this.EpisodePlayer?.$destroy();
		this.unsubscribeEpisode();

        this.contentEl.empty();    
    }

    private render() {
		this.FeedGrid?.$destroy();
        this.EpisodePlayer?.$destroy();

        if (!this.episode) {
            this.showFeedGrid();
        } else {
            this.showEpisodeView();
        }
    }

	private showFeedGrid(): void {
        const savedFeeds: PodcastFeed[] = Object.values(this.plugin.settings.savedFeeds);

        this.FeedGrid = new FeedGrid({
            target: this.contentEl,
            props: {
                feeds: savedFeeds,
                onClickFeed: async (feed: PodcastFeed) => {
                    await this.getPodcast(feed);
                    this.render();
                },
            }
        });
    }

    private showEpisodeView(): void {
        this.EpisodePlayer = new EpisodePlayer({
            target: this.contentEl,
		});
    }

    private async getPodcast(feed: PodcastFeed): Promise<void> {
        try {
			const parser = new FeedParser(feed);
            const episode = (await parser.parse(feed.url))[0];
			currentEpisode.set(episode);
			//const parser = new PocketCastsParser(url);
			//this._podcast = await parser.parse();
        } catch (error) {
            new Notice(error, 5000);
        }
    }
}
