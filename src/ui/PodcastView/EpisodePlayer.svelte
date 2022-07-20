<script lang="ts">
	import {
		duration,
		currentTime,
		currentEpisode,
		isPaused,
		plugin,
		playedEpisodes,
		queue,
		playlists,
	} from "src/store";
	import { formatSeconds } from "src/utility/formatSeconds";
	import { onDestroy } from "svelte";
	import Icon from "../obsidian/Icon.svelte";
	import Button from "../obsidian/Button.svelte";
	import Slider from "../obsidian/Slider.svelte";
	import Loading from "./Loading.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import Progressbar from "../common/Progressbar.svelte";

	// Circumventing the forced two-way binding of the playback rate.
	class Pr {
		public get _playbackRate() {
			return playbackRate;
		}
	}

	const pr = new Pr();

	let playbackRate: number = $plugin.settings.defaultPlaybackRate || 1;
	let isHoveringArtwork: boolean = false;
	let isLoading: boolean = true;

	function togglePlayback() {
		isPaused.update((value) => !value);
	}

	function onClickProgressbar({ detail: { event } }: CustomEvent<{ event: MouseEvent }>) {
		const progressbar = event.target as HTMLDivElement;
		const percent = event.offsetX / progressbar.offsetWidth;

		currentTime.set(percent * $duration);
	}

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

	function removeEpisodeFromPlaylists() {
		playlists.update((lists) => {
			Object.values(lists).forEach((playlist) => {
				playlist.episodes = playlist.episodes.filter(
					(ep) => ep.title !== $currentEpisode.title
				);
			});

			return lists;
		});

		queue.update((q) => {
			q.episodes = q.episodes.filter(
				(ep) => ep.title !== $currentEpisode.title
			);
			return q;
		});
	}

	function playNextInQueue() {
		queue.update((q) => {
			const nextEp = q.episodes.shift();

			if (nextEp) {
				currentEpisode.set(nextEp);
			}

			return q;
		});
	}

	function onEpisodeEnded() {
		markEpisodeAsPlayed();
		removeEpisodeFromPlaylists();

		playNextInQueue();
	}

	function onPlaybackRateChange(event: CustomEvent<{ value: number }>) {
		playbackRate = event.detail.value;
	}

	function onMetadataLoaded() {
		isLoading = false;

		updateTime();
	}

	function updateTime() {
		const playedEps = $playedEpisodes;
		const currentEp = $currentEpisode;

		if (playedEps[currentEp.title]) {
			currentTime.set(playedEps[currentEp.title].time);
		} else {
			currentTime.set(0);
		}

		isPaused.set(false);
	}

	onDestroy(() => {
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
			{#if isLoading}
				<div class="podcast-artwork-isloading-overlay">
					<Loading />
				</div>
			{:else}
				<div
					class="podcast-artwork-overlay"
					style={`display: ${
						isHoveringArtwork || $isPaused ? "block" : "none"
					}`}
				>
					<Icon icon={$isPaused ? "play" : "pause"} />
				</div>
			{/if}
		</div>
	</div>

	<h2 class="podcast-title">{$currentEpisode.title}</h2>

	<audio
		src={$currentEpisode.streamUrl}
		bind:duration={$duration}
		bind:currentTime={$currentTime}
		bind:paused={$isPaused}
		bind:playbackRate={pr._playbackRate}
		on:ended={onEpisodeEnded}
		on:loadedmetadata={onMetadataLoaded}
	/>

	<div class="status-container">
		<span>{formatSeconds($currentTime, "HH:mm:ss")}</span>
		<Progressbar 
			on:click={onClickProgressbar}
			value={$currentTime}
			max={$duration}
			style={{
				"height": "2rem",
			}}
		/>
		<span>{formatSeconds($duration - $currentTime, "HH:mm:ss")}</span>
	</div>

	<div class="controls-container">
		<Button
			icon="skip-back"
			tooltip="Skip backward"
			on:click={$plugin.api.skipBackward.bind($plugin.api)}
			style={{
				margin: "0",
				cursor: "pointer",
			}}
		/>
		<Button
			icon="skip-forward"
			tooltip="Skip forward"
			on:click={$plugin.api.skipForward.bind($plugin.api)}
			style={{
				margin: "0",
				cursor: "pointer",
			}}
		/>
	</div>

	<div class="playbackrate-container">
		<span>{playbackRate}x</span>
		<Slider
			on:change={onPlaybackRateChange}
			value={playbackRate}
			limits={[0.5, 3.5, 0.1]}
		/>
	</div>

	<EpisodeList episodes={$queue.episodes} showListMenu={false}>
		<svelte:fragment slot="header">
			<h3>Queue</h3>
		</svelte:fragment>
	</EpisodeList>
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

	.podcast-artwork-isloading-overlay {
		position: absolute;
		display: block;
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
