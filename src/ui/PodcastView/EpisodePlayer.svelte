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
		viewState,
		downloadedEpisodes,
	} from "src/store";
	import { formatSeconds } from "src/utility/formatSeconds";
	import { onDestroy, onMount } from "svelte";
	import Icon from "../obsidian/Icon.svelte";
	import Button from "../obsidian/Button.svelte";
	import Dropdown from "../obsidian/Dropdown.svelte";
	import Loading from "./Loading.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import Progressbar from "../common/Progressbar.svelte";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import type { Episode } from "src/types/Episode";
	import { ViewState } from "src/types/ViewState";
	import { createMediaUrlObjectFromFilePath } from "src/utility/createMediaUrlObjectFromFilePath";
	import Image from "../common/Image.svelte";
	import { fade, slide } from "svelte/transition";

	// #region Circumventing the forced two-way binding of the playback rate.
	class CircumentForcedTwoWayBinding {
		public playbackRate: number = $plugin.settings.defaultPlaybackRate || 1;

		public get _playbackRate() {
			return this.playbackRate;
		}
	}

	const offBinding = new CircumentForcedTwoWayBinding();
	//#endregion

	let isHoveringArtwork = false;
	let isLoading = true;
	let showQueue = false;

	function togglePlayback() {
		isPaused.update((value) => !value);
	}

	function onClickProgressbar({
		detail: { event },
	}: CustomEvent<{ event: MouseEvent }>) {
		const progressbar = event.target as HTMLDivElement;
		const percent = event.offsetX / progressbar.offsetWidth;

		currentTime.set(percent * $duration);
	}

	function removeEpisodeFromPlaylists() {
		playlists.update((lists) => {
			for (const playlist of Object.values(lists)) {
				playlist.episodes = playlist.episodes.filter(
					(ep) => ep.title !== $currentEpisode.title
				);
			}
			return lists;
		});

		queue.remove($currentEpisode);
	}

	function onEpisodeEnded() {
		playedEpisodes.markAsPlayed($currentEpisode);
		removeEpisodeFromPlaylists();

		queue.playNext();
	}

	function onPlaybackRateChange(event: CustomEvent<{ value: string }>) {
		offBinding.playbackRate = Number.parseFloat(event.detail.value);
	}

	function onMetadataLoaded() {
		isLoading = false;

		restorePlaybackTime();
	}

	function restorePlaybackTime() {
		const playedEps = $playedEpisodes;
		const currentEp = $currentEpisode;

		if (playedEps[currentEp.title]) {
			currentTime.set(playedEps[currentEp.title].time);
		} else {
			currentTime.set(0);
		}

		isPaused.set(false);
	}

	let srcPromise: Promise<string> = getSrc($currentEpisode);

	// #region Keep player time and currentTime in sync
	// Simply binding currentTime to the audio element will result in resets.
	// Hence the following solution.
	let playerTime: number = 0;

	onMount(() => {
		const unsub = currentTime.subscribe((ct) => {
			playerTime = ct;
		});

		// This only happens when the player is open and the user downloads the episode via the context menu.
		// So we want to update the source of the audio element to local file / online stream.
		const unsubDownloadedSource = downloadedEpisodes.subscribe((_) => {
			srcPromise = getSrc($currentEpisode);
		});

		const unsubCurrentEpisode = currentEpisode.subscribe((_) => {
			srcPromise = getSrc($currentEpisode);
		});

		return () => {
			unsub();
			unsubDownloadedSource();
			unsubCurrentEpisode();
		};
	});

	$: {
		currentTime.set(playerTime);
	}
	// #endregion

	onDestroy(() => {
		playedEpisodes.setEpisodeTime(
			$currentEpisode,
			$currentTime,
			$duration,
			$currentTime === $duration,
		);
		isPaused.set(true);
	});

	function handleContextMenuEpisode({
		detail: { event, episode },
	}: CustomEvent<{ episode: Episode; event: MouseEvent }>) {
		spawnEpisodeContextMenu(episode, event);
	}

	function handleContextMenuEpisodeImage(event: MouseEvent) {
		spawnEpisodeContextMenu($currentEpisode, event, {
			play: true,
			markPlayed: true,
		});
	}

	function handleClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		const { episode } = event.detail;
		currentEpisode.set(episode);

		viewState.set(ViewState.Player);
	}

	async function getSrc(episode: Episode): Promise<string> {
		if (downloadedEpisodes.isEpisodeDownloaded(episode)) {
			const downloadedEpisode = downloadedEpisodes.getEpisode(episode);
			if (!downloadedEpisode) return "";

			return createMediaUrlObjectFromFilePath(downloadedEpisode.filePath);
		}

		return episode.streamUrl;
	}

	function toggleQueue() {
		showQueue = !showQueue;
	}


	const playbackRates = {
		"0.50": "0.5x",
		"0.75": "0.75x",
		"1.00": "1x",
		"1.25": "1.25x",
		"1.50": "1.5x",
		"1.75": "1.75x",
		"2.00": "2x"
	};

</script>

<div class="episode-player" transition:fade={{ duration: 300 }}>
	<div class="episode-image-container">
		<div
			class="hover-container"
			on:click={togglePlayback}
			on:contextmenu={handleContextMenuEpisodeImage}
			on:mouseenter={() => (isHoveringArtwork = true)}
			on:mouseleave={() => (isHoveringArtwork = false)}
		>
			<Image
				class="podcast-artwork"
				src={$currentEpisode.artworkUrl ?? ""}
				alt={$currentEpisode.title}
				opacity={isHoveringArtwork || $isPaused ? 0.5 : 1}
			>
				<svelte:fragment slot="fallback">
					<div
						class={"podcast-artwork-placeholder" +
							(isHoveringArtwork || $isPaused
								? " opacity-50"
								: "")}
					>
						<Icon icon="image" size={150} />
					</div>
				</svelte:fragment>
			</Image>
			{#if isLoading}
				<div class="podcast-artwork-isloading-overlay">
					<Loading />
				</div>
			{:else}
				<div
					class="podcast-artwork-overlay"
					style={`display: ${isHoveringArtwork || $isPaused ? "flex" : "none"}`}
				>
					<Icon icon={$isPaused ? "play" : "pause"} size={64} />
				</div>
			{/if}
		</div>
	</div>

	<div class="episode-info">
		<h2 class="podcast-title">{$currentEpisode.title}</h2>
		<p class="podcast-author">{$currentEpisode.podcastName}</p>
	</div>

	{#await srcPromise then src}
		<audio
			{src}
			bind:duration={$duration}
			bind:currentTime={playerTime}
			bind:paused={$isPaused}
			bind:playbackRate={offBinding._playbackRate}
			on:ended={onEpisodeEnded}
			on:loadedmetadata={onMetadataLoaded}
			on:play|preventDefault
			autoplay={true}
		/>
	{/await}

	<div class="progress-container">
		<div class="time-display">
			{formatSeconds($currentTime, "HH:mm:ss")}
		</div>
		<Progressbar
			on:click={onClickProgressbar}
			value={$currentTime}
			max={$duration}
			style={{
				height: "0.5rem",
				"flex-grow": "1",
				margin: "0 1rem",
			}}
		/>
		<div class="time-display">
			{formatSeconds($duration - $currentTime, "HH:mm:ss")}
		</div>
	</div>

	<div class="controls-container">
		<Button
			icon="skip-back"
			tooltip="Skip backward"
			on:click={$plugin.api.skipBackward.bind($plugin.api)}
		/>
		<Button
			icon={$isPaused ? "play" : "pause"}
			tooltip={$isPaused ? "Play" : "Pause"}
			on:click={togglePlayback}
			class="play-pause-button"
		/>
		<Button
			icon="skip-forward"
			tooltip="Skip forward"
			on:click={$plugin.api.skipForward.bind($plugin.api)}
		/>
		<Button icon="list" tooltip="Toggle queue" on:click={toggleQueue} />
		<div class="playback-rate-container">
			<Dropdown
				options={playbackRates}
				value={offBinding.playbackRate.toFixed(2)}
				on:change={onPlaybackRateChange}
				style={{
					minWidth: "70px",
					textAlign: "center"
				}}
			/>
		</div>
	</div>

	{#if showQueue}
		<div class="queue-container" transition:slide>
			<EpisodeList
				episodes={$queue.episodes}
				showListMenu={false}
				showThumbnails={true}
				on:contextMenuEpisode={handleContextMenuEpisode}
				on:clickEpisode={handleClickEpisode}
			>
				<svelte:fragment slot="header">
					<h3>Queue</h3>
				</svelte:fragment>
			</EpisodeList>
		</div>
	{/if}
</div>

<style>
	.episode-player {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem;
		background-color: var(--background-secondary);
		border-radius: 8px;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
	}

	.episode-image-container {
		width: 100%;
		max-width: 300px;
		margin: 0 auto 1rem;
	}

	.hover-container {
		position: relative;
		aspect-ratio: 1/1;
		border-radius: 8px;
		overflow: hidden;
	}

	.podcast-artwork,
	.podcast-artwork-placeholder {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}

	.podcast-artwork-overlay {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: rgba(0, 0, 0, 0.5);
		cursor: pointer;
	}

	.episode-info {
		text-align: center;
		margin-bottom: 1rem;
	}

	.podcast-title {
		font-size: 1.2rem;
		font-weight: bold;
		margin: 0;
		margin-bottom: 0.5rem;
	}

	.podcast-author {
		font-size: 0.9rem;
		color: var(--text-muted);
		margin: 0;
	}

	.progress-container {
		display: flex;
		align-items: center;
		margin-bottom: 1rem;
	}

	.time-display {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.controls-container {
		display: flex;
		justify-content: center;
		align-items: center;
		margin-bottom: 1rem;
	}

	.controls-container :global(button) {
		margin: 0 0.5rem;
	}

	.play-pause-button {
		width: 3rem;
		height: 3rem;
	}

	.queue-container {
		margin-top: 1rem;
	}
</style>