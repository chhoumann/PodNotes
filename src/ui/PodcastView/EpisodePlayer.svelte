<script lang="ts">
    import { ButtonComponent, Setting } from "obsidian";
	import { duration, currentTime, currentEpisode, isPaused } from "src/store";

    import { formatSeconds } from "src/utility/formatSeconds";
    import { onDestroy, onMount } from "svelte";
	import { Unsubscriber } from "svelte/store";

    let buttonRef: HTMLSpanElement;
    let playbackRateRef: HTMLSpanElement;
	let unsubscriber: Unsubscriber;
	let playbackRate: number = 1;

    onMount(() => {
        const buttonComponent = new ButtonComponent(buttonRef);
        buttonComponent.setButtonText("Play");
        buttonComponent.setClass("play-button");
        buttonComponent.setCta();
        buttonComponent.onClick(() => {
			isPaused.update((value) => {
				return !value;
			});
        });

		unsubscriber = isPaused.subscribe(value => {
			const btnText = value ? "Play" : "Pause";
			buttonComponent.setButtonText(btnText);
		});

        const playbackRateComponent = new Setting(playbackRateRef);
        playbackRateComponent.addSlider(slider => slider
            .setLimits(0.5, 4, 0.1)
            .setValue(playbackRate)
            .onChange(value => playbackRate = value)
        );
    });

	onDestroy(() => unsubscriber());

	function onClickProgressbar(e: MouseEvent) {
		const progressbar = e.target as HTMLDivElement;
		const percent = e.offsetX / progressbar.offsetWidth;
		currentTime.set(percent * $duration);
	}

</script>

<div class="episode-player">
    <div class="image-container">
        <img 
            class="podcast-artwork"
            src={$currentEpisode.artworkUrl}
            alt={$currentEpisode.title}
        />
    </div>

    <h2 class="podcast-title">{$currentEpisode.title}</h2>

    <audio 
        src={$currentEpisode.streamUrl} 
        bind:duration={$duration}
        bind:currentTime={$currentTime}
		bind:paused={$isPaused}
		bind:playbackRate={playbackRate}
    />

    <div class="status-container">
        <span>{formatSeconds($currentTime, "HH:mm:ss")}</span>
        <progress
			style="height: 2rem;" 
			max={$duration} 
			value={$currentTime} 
			on:click={onClickProgressbar}
		/>
        <span>{formatSeconds($duration, "HH:mm:ss")}</span>
    </div>

    <div class="play-button-container">
        <span bind:this={buttonRef} />
    </div>
    
    <div class="controls-container">
		<span>{playbackRate}x</span>
   	    <span bind:this={playbackRateRef} />
    </div>
</div>
