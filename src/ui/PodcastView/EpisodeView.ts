import { ButtonComponent, Notice, Setting } from "obsidian";
import { Player } from "src/Player";
import { Episode } from "src/types/Episode";

interface Props {
    podcast: Episode;
    audioEl: HTMLAudioElement;
    controlsButton: ButtonComponent;
}

export default function EpisodeView(container: HTMLElement, {podcast, audioEl}: Props): void {
    // const imageContainer = container.createDiv();
    // imageContainer.addClass('image-container');
    // const img = imageContainer.createEl('img');
    // img.src = podcast.artworkUrl || "";
    // img.addClass('podcast-artwork');

    // const title = container.createEl('h2', {text: podcast.title});
    // title.style.textAlign = "center";

    // audioEl = container.createEl('audio');
    // audioEl.src = podcast.streamUrl;

    // const controlsContainer = container.createEl('div');
    // controlsContainer.classList.add('controls-container');

    // this.controlsButton = new ButtonComponent(controlsContainer);
    // this.controlsButton.setButtonText("Play")
    // this.controlsButton.onClick(() => {
    //     if (Player.Instance.isPlaying) {
    //         Player.Instance.stop();
    //         this.controlsButton.setButtonText("Play");
    //     } else {
    //         Player.Instance.start();
    //         this.controlsButton.setButtonText("Pause");
    //     }
    // });

    // const playbackRate = new Setting(controlsContainer);
    // playbackRate.setName("Playback Rate");
    // playbackRate.addSlider(slider => slider
    //     .setLimits(0.5, 4, 0.1)
    //     .setValue(this.audioEl.playbackRate)
    //     .onChange(value => this.audioEl.playbackRate = value)
    //     .setDynamicTooltip()
    // );

    // Sleep until the audio element is loaded.
    // This is a hacky way to do this, but it works.
    // const interval = window.setInterval(() => {
    //     if (this.audioEl.readyState === 4) {
    //         clearInterval(interval);
    //         this.addProgressBar();
    //     }
    // }, 100);

    // this.registerInterval(interval);

    // this.registerDomEvent(this.audioEl, 'play', this.onStartPodcast.bind(this));
    // this.registerDomEvent(this.audioEl, 'pause', this.onStopPodcast.bind(this));
    // this.registerDomEvent(this.audioEl, 'ended', this.onStopPodcast.bind(this));
    // this.registerDomEvent(this.audioEl, 'error', () => {
    //     new Notice("Error playing podcast.");
    //     Player.Instance.stop();
    // });

}