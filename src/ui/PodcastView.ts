import { ButtonComponent, ItemView, Notice, Setting, TextComponent } from "obsidian";
import { VIEW_TYPE } from "../constants";
import { PocketCastsParser } from "../parser/pcastParser";
import { Player, PlayerEvents } from "../Player";
import { Podcast } from "../types/podcast";
import { formatSeconds } from "../utility/formatSeconds";

export class PodcastView extends ItemView {
    public get podcast(): Podcast { return this._podcast; }
    public get currentTime(): number { return this.audioEl.currentTime; }
    public get duration(): number { return this.audioEl.duration; }

    private _podcast: Podcast;
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
    }

    protected async onClose(): Promise<void> {
        this.contentEl.empty();        

        Player.Instance.off(PlayerEvents.START_PLAYING, this.onStartPodcast.bind(this));
        Player.Instance.off(PlayerEvents.STOP_PLAYING, this.onStopPodcast.bind(this));
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
        const container = this.contentEl.createDiv();
        container.addClass('podcast-input-container');

        const inputEl = new TextComponent(container);
		inputEl.inputEl.style.marginBottom = "0.25rem";
		inputEl.setPlaceholder("Podcast URL");
		
        const buttonEl = new ButtonComponent(container);
        buttonEl.setButtonText("Go!")
        buttonEl.onClick(() => {
            this.getPodcast(inputEl.getValue()).then(() => this.render());
        });
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

    private async getPodcast(url: string) {
        try {
            const parser = new PocketCastsParser(url);
			this._podcast = await parser.parse();
        } catch (error) {
            new Notice(error, 5000);
        }
    }
}
