import { PodcastFeed } from 'src/types/PodcastFeed';
import { IPodNotes } from './../main';
import { ButtonComponent, ItemView, Notice, Setting, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE } from "../constants";
import { Player, PlayerEvents } from "../Player";
import { Episode } from "../types/Episode";
import { formatSeconds } from "../utility/formatSeconds";
import FeedParser from 'src/parser/feedParser';

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
        this.contentEl.empty();        

        if (!this._podcast) {
            this.initialState();
        } else {
            this.podcastState();
        }
    }

	private initialState(): void {
		const savedFeeds = Object.values(this.plugin.settings.savedFeeds);

		if (!savedFeeds.length) {
			const noPodcastsIndicator = this.contentEl.createEl('p', { text: 'No saved podcasts' });
			noPodcastsIndicator.style.textAlign = "center";

			return;
		}
		
		// Create feed grid
		const feedGrid = this.contentEl.createDiv();
		feedGrid.classList.add('feed-grid', 'grid-3');

		// Make clickable image for each entry
		savedFeeds.forEach(feed => {
			const feedImage = feedGrid.createEl('img');
			feedImage.src = feed.artworkUrl;
			feedImage.addClass('feed-image');
			feedImage.onclick = async () => {
				await this.getPodcast(feed);
				this.render();
			}
		});
		


/*         const container = this.contentEl.createDiv();
        container.addClass('podcast-input-container');

        const inputEl = new TextComponent(container);
		inputEl.inputEl.style.marginBottom = "0.25rem";
		inputEl.setPlaceholder("Podcast URL");
		
        const buttonEl = new ButtonComponent(container);
        buttonEl.setButtonText("Go!")
        buttonEl.onClick(() => {
            this.getPodcast(inputEl.getValue()).then(() => this.render());
        }); */
    }

    private podcastState(): void {
		const imageContainer = this.contentEl.createDiv();
		imageContainer.addClass('image-container');
		const img = imageContainer.createEl('img');
		img.src = this._podcast.artworkUrl || "";
		img.addClass('podcast-artwork');

        const title = this.contentEl.createEl('h2', {text: this._podcast.title});
        title.style.textAlign = "center";

        this.audioEl = this.contentEl.createEl('audio');
        this.audioEl.src = this._podcast.streamUrl;

        const controlsContainer = this.contentEl.createEl('div');
        controlsContainer.classList.add('controls-container');

        this.controlsButton = new ButtonComponent(controlsContainer);
        this.controlsButton.setButtonText("Play")
        this.controlsButton.onClick(() => {
            if (Player.Instance.isPlaying) {
                Player.Instance.stop();
                this.controlsButton.setButtonText("Play");
            } else {
                Player.Instance.start();
                this.controlsButton.setButtonText("Pause");
            }
        });

        const playbackRate = new Setting(controlsContainer);
        playbackRate.setName("Playback Rate");
        playbackRate.addSlider(slider => slider
            .setLimits(0.5, 4, 0.1)
            .setValue(this.audioEl.playbackRate)
            .onChange(value => this.audioEl.playbackRate = value)
            .setDynamicTooltip()
        );

        // Sleep until the audio element is loaded.
        // This is a hacky way to do this, but it works.
        const interval = window.setInterval(() => {
			if (this.audioEl.readyState === 4) {
				clearInterval(interval);
				this.addProgressBar();
			}
        }, 100);

		this.registerInterval(interval);


		this.registerDomEvent(this.audioEl, 'play', this.onStartPodcast.bind(this));
		this.registerDomEvent(this.audioEl, 'pause', this.onStopPodcast.bind(this));
		this.registerDomEvent(this.audioEl, 'ended', this.onStopPodcast.bind(this));
		this.registerDomEvent(this.audioEl, 'error', () => {
            new Notice("Error playing podcast.");
            Player.Instance.stop();
		});
    }

    private addProgressBar(): void {
        const statusContainer = this.contentEl.createEl('div');
        statusContainer.classList.add('status-container');

        const ctime = this.audioEl.currentTime;
        const ctimeEl = statusContainer.createEl('span');
        ctimeEl.setText(formatSeconds(ctime, "HH:mm:ss"));

        this.progressBarEl = statusContainer.createEl('progress');
        const endTime = this.audioEl.duration;
        this.progressBarEl.max = endTime;
        this.progressBarEl.value = ctime;

        const endTimeEl = statusContainer.createEl('span');
        endTimeEl.setText(formatSeconds(endTime, "HH:mm:ss"));

		this.registerDomEvent(this.audioEl, 'timeupdate', () => {
			ctimeEl.setText(formatSeconds(this.audioEl.currentTime, "HH:mm:ss"));
			this.progressBarEl.value = this.audioEl.currentTime;
		});

		this.registerDomEvent(this.progressBarEl, 'click', (e: MouseEvent) => {
			const percent = e.offsetX / this.progressBarEl.offsetWidth;
			this.audioEl.currentTime = percent * this.audioEl.duration;
		});
    }

    private onStartPodcast() {
        if (!this.audioEl.paused) return;

        this.audioEl.play()
		this.controlsButton.setButtonText("Pause");

    }

    private onStopPodcast() {
        if (this.audioEl.paused) return;

        this.audioEl.pause();
		this.controlsButton.setButtonText("Play");
    }

    private async getPodcast(feed: PodcastFeed) {
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
