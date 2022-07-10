<script lang="ts">
	import { ButtonComponent, setIcon, SliderComponent } from "obsidian";
	import {
		duration,
		currentTime,
		currentEpisode,
		isPaused,
		plugin,
		playedEpisodes,
	} from "src/store";
	import { IconType } from "src/types/IconType";
	import { formatSeconds } from "src/utility/formatSeconds";
	import { onDestroy, onMount } from "svelte";
	import { get, Unsubscriber } from "svelte/store";

	let playbackRateRef: HTMLSpanElement;
	let iconRef: HTMLSpanElement;
	let skipBackwardRef: HTMLSpanElement;
	let skipForwardRef: HTMLSpanElement;
	let unsubscriber: Unsubscriber;
	let playbackRate: number = get(plugin).settings.defaultPlaybackRate || 1;
	let isHoveringArtwork: boolean = false;

	function togglePlayback() {
		isPaused.update((value) => !value);
	}

	function onClickProgressbar(e: MouseEvent) {
		const progressbar = e.target as HTMLDivElement;
		const percent = e.offsetX / progressbar.offsetWidth;
		currentTime.set(percent * $duration);
	}

	onMount(() => {
		const playedEps = $playedEpisodes;
		const currentEp = $currentEpisode;

		if (playedEps[currentEp.title]) {
			currentTime.set(playedEps[currentEp.title].time);
			duration.set(playedEps[currentEp.title].duration);
			isPaused.set(false);
		} else {
			duration.set(0);
			currentTime.set(0);
		}

		unsubscriber = isPaused.subscribe((value) => {
			const btnIcon = value ? "pause" : "play";
			setIcon(iconRef, btnIcon);
		});

		new SliderComponent(playbackRateRef)
			.setLimits(0.5, 3.5, 0.1)
			.setValue(playbackRate)
			.onChange((value) => (playbackRate = value));

		const skipBackBtn = new ButtonComponent(skipBackwardRef)
			.setIcon("skip-back" as IconType)
			.setTooltip("Skip backward")
			.onClick($plugin.api.skipBackward.bind($plugin.api));

		const skipForwardBtn = new ButtonComponent(skipForwardRef)
			.setIcon("skip-forward" as IconType)
			.setTooltip("Skip forward")
			.onClick($plugin.api.skipForward.bind($plugin.api));

		skipBackBtn.buttonEl.style.margin = "0";
		skipBackBtn.buttonEl.style.cursor = "pointer";
		skipForwardBtn.buttonEl.style.margin = "0";
		skipForwardBtn.buttonEl.style.cursor = "pointer";

		isPaused.set(false);
	});

	onDestroy(() => {
		unsubscriber();

		playedEpisodes.update((playedEpisodes) => {
			const currentEp = $currentEpisode;
			const curTime = $currentTime;
			const dur = $duration;

			playedEpisodes[currentEp.title] = {
				title: currentEp.title,
				podcastName: currentEp.podcastName,
				time: curTime,
				duration: dur,
				finished: curTime === dur,
			};

			return playedEpisodes;
		});

		isPaused.set(true);
	});

	function markEpisodeAsPlayed() {
		playedEpisodes.update((playedEpisodes) => {
			const currentEp = $currentEpisode;

			playedEpisodes[currentEp.title] = {
				...currentEp,
				time: $currentTime,
				duration: $duration,
				finished: true,
			};

			return playedEpisodes;
		});
	}
</script>

<div class="episode-player">
	<div class="episode-image-container">
		<div
			class="hover-container"
			on:click={togglePlayback}
			on:mouseenter={() => (isHoveringArtwork = true)}
			on:mouseleave={() => (isHoveringArtwork = false)}
		>
			<img
				class={"podcast-artwork" +
					(isHoveringArtwork || $isPaused ? " opacity-50" : "")}
				src={$currentEpisode.artworkUrl}
				alt={$currentEpisode.title}
			/>
			<div
				class="podcast-artwork-overlay"
				style={`display: ${
					isHoveringArtwork || $isPaused ? "block" : "none"
				}`}
			>
				<span bind:this={iconRef} />
			</div>
		</div>
	</div>

	<h2 class="podcast-title">{$currentEpisode.title}</h2>

	<audio
		src={$currentEpisode.streamUrl}
		bind:duration={$duration}
		bind:currentTime={$currentTime}
		bind:paused={$isPaused}
		bind:playbackRate
		on:ended={markEpisodeAsPlayed}
	/>

	<div class="status-container">
		<span>{formatSeconds($currentTime, "HH:mm:ss")}</span>
		<progress
			style="height: 2rem;"
			max={$duration}
			value={$currentTime}
			on:click={onClickProgressbar}
		/>
		<span>{formatSeconds($duration - $currentTime, "HH:mm:ss")}</span>
	</div>

	<div class="controls-container">
		<span bind:this={skipBackwardRef} />
		<span bind:this={skipForwardRef} />
	</div>

	<div class="playbackrate-container">
		<span>{playbackRate}x</span>
		<span bind:this={playbackRateRef} />
	</div>
</div>

<style>
	.episode-player {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.episode-image-container {
		width: 100%;
		padding: 5% 20%;
	}

	.hover-container {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.podcast-artwork {
		width: 100%;
		height: 100%;
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
	}

	/* Some themes override this, so opting to force like so. */
	.podcast-artwork:hover {
		cursor: pointer !important;
	}

	.podcast-artwork-overlay {
		position: absolute;
	}

	.podcast-artwork-overlay:hover {
		cursor: pointer !important;
	}

	.opacity-50 {
		opacity: 0.5;
	}

	.podcast-title {
		font-size: 1.5rem;
		font-weight: bold;
		margin: 0%;
		margin-bottom: 0.5rem;
		text-align: center;
	}

	.status-container {
		display: flex;
		align-items: center;
		justify-content: space-around;
	}

	.controls-container {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 1rem;
		margin-left: 25%;
		margin-right: 25%;
	}

	.playbackrate-container {
		display: flex;
		align-items: center;
		justify-content: space-around;
		margin-bottom: 2.5rem;
		flex-direction: column;
		margin-top: auto;
	}
</style>
