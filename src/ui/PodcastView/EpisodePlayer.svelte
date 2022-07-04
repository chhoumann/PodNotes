<script lang="ts">
    import { ButtonComponent, Setting } from "obsidian";
    import { Player } from "src/Player";

    import { Episode } from "src/types/Episode";
    import { formatSeconds } from "src/utility/formatSeconds";
    import { onMount } from "svelte";

    export let episode: Episode;
    export let audioEl: HTMLAudioElement;
    export let duration: number = 0;
    export let currentTime: number = 0;

    export let onStart: () => void;
    export let onStop: () => void;
    export let onEnded: () => void;

    let buttonRef: HTMLSpanElement;
    let playbackRateRef: HTMLSpanElement;

    onMount(() => {
        const buttonComponent = new ButtonComponent(buttonRef);
        buttonComponent.setButtonText("Play");
        buttonComponent.setClass("play-button");
        buttonComponent.setCta();
        buttonComponent.onClick(() => {
        if (Player.Instance.isPlaying) {
            Player.Instance.stop();
            buttonComponent.setButtonText("Play");
        } else {
            Player.Instance.start();
            buttonComponent.setButtonText("Pause");
        }
        });

        const playbackRateComponent = new Setting(playbackRateRef);
        playbackRateComponent.setName("Playback Rate");
        playbackRateComponent.addSlider(slider => slider
            .setLimits(0.5, 4, 0.1)
            .setValue(audioEl.playbackRate)
            .onChange(value => audioEl.playbackRate = value)
            .setDynamicTooltip()
        );
    })
</script>

<div class="episode-player">
    <div class="image-container">
        <img 
            class="podcast-artwork"
            src={episode.artworkUrl}
            alt={episode.title}
        />
    </div>

    <h2 class="podcast-title">{episode.title}</h2>

    <audio 
        src={episode.streamUrl} 
        bind:this={audioEl} 
        bind:duration={duration}
        bind:currentTime={currentTime}
        on:play={onStart}
        on:pause={onStop}
        on:ended={onEnded}
    />

    <div class="status-container">
        <span>{formatSeconds(currentTime, "HH:mm:ss")}</span>
        <progress style="height: 2rem;" max={duration} value={currentTime} />
        <span>{formatSeconds(duration, "HH:mm:ss")}</span>
    </div>

    <div class="play-button-container">
        <span bind:this={buttonRef} />
    </div>
    
    <div class="controls-container">
        <span bind:this={playbackRateRef} />
    </div>
</div>