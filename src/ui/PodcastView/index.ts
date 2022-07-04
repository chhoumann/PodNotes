import { PodcastFeed } from 'src/types/PodcastFeed';
import { IPodNotes } from '../../main';
import { ButtonComponent, ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../../constants";
import { Player, PlayerEvents } from "../../Player";
import { Episode } from "../../types/Episode";
import { formatSeconds } from "../../utility/formatSeconds";
import FeedParser from 'src/parser/feedParser';
import FeedGrid from './FeedGrid.svelte';
import EpisodePlayer from './EpisodePlayer.svelte';

export class PodcastView extends ItemView {
	constructor(leaf: WorkspaceLeaf, private plugin: IPodNotes) {
		super(leaf);
	}   

    public get podcast(): Episode { return this._podcast; }
    public get currentTime(): number { return this.audioEl.currentTime; }
    public get duration(): number { return this.audioEl.duration; }

    private _podcast: Episode;
    private audioEl: HTMLAudioElement;
    private progressBarEl: HTMLProgressElement;
	private controlsButton: ButtonComponent;

    private FeedGrid: FeedGrid;
    private EpisodePlayer: EpisodePlayer;

    getViewType(): string {
        return VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Podcast Player";
    }

    getIcon(): string {
        return "dice";
    }

	public clearPodcast() {
		//@ts-ignore
		this._podcast = null;
		this.render();
	}
    
    protected async onOpen(): Promise<void> {
        this.render();

        Player.Instance.on(PlayerEvents.START_PLAYING, this.onStartPodcast.bind(this));
        Player.Instance.on(PlayerEvents.STOP_PLAYING, this.onStopPodcast.bind(this));
        Player.Instance.on(PlayerEvents.NEW_PODCAST, this.onNewPodcast.bind(this));
    }

    protected async onClose(): Promise<void> {
        this.FeedGrid?.$destroy();
        this.EpisodePlayer?.$destroy();

        this.contentEl.empty();        

        Player.Instance.off(PlayerEvents.START_PLAYING, this.onStartPodcast.bind(this));
        Player.Instance.off(PlayerEvents.STOP_PLAYING, this.onStopPodcast.bind(this));
        Player.Instance.off(PlayerEvents.NEW_PODCAST, this.onNewPodcast.bind(this));
    }

	private onNewPodcast() {
		if (this._podcast) return;

		this.render();
	}

    private render() {
        if (!this._podcast) {
            this.showFeedGrid();
        } else {
            this.showEpisodeView();
        }
    }

	private showFeedGrid(): void {
        this.FeedGrid?.$destroy();

        const savedFeeds: PodcastFeed[] = Object.values(this.plugin.settings.savedFeeds);

        this.FeedGrid = new FeedGrid({
            target: this.contentEl,
            props: {
                feeds: savedFeeds,
                onClickFeed: async (feed: PodcastFeed) => {
                    await this.getPodcast(feed);
                    this.FeedGrid.$destroy();
                    this.render();
                },
            }
        });
    }

    private showEpisodeView(): void {
        this.EpisodePlayer?.$destroy();

        this.EpisodePlayer = new EpisodePlayer({
            target: this.contentEl,
            props: {
                episode: this._podcast,
                audioEl: this.audioEl,
            }
        });
    }

    private onStartPodcast() {
        if (!this.audioEl.paused) return;

        this.audioEl.play()
		// this.controlsButton.setButtonText("Pause");

    }

    private onStopPodcast() {
        if (this.audioEl.paused) return;

        this.audioEl.pause();
		// this.controlsButton.setButtonText("Play");
    }

    private async getPodcast(feed: PodcastFeed): Promise<void> {
        try {
			const parser = new FeedParser(feed);
            const episode = (await parser.parse(feed.url))[0];
			this._podcast = episode;
			//const parser = new PocketCastsParser(url);
			//this._podcast = await parser.parse();
        } catch (error) {
            new Notice(error, 5000);
        }
    }
}
