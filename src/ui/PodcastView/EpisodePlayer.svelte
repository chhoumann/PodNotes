<script lang="ts">
	import {
		duration,
		currentTime,
		currentEpisode,
		isPaused,
		plugin,
		volume,
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
	import Slider from "../obsidian/Slider.svelte";
	import Loading from "./Loading.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import Progressbar from "../common/Progressbar.svelte";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import type { Episode } from "src/types/Episode";
	import { ViewState } from "src/types/ViewState";
	import { createMediaUrlObjectFromFilePath } from "src/utility/createMediaUrlObjectFromFilePath";
	import Image from "../common/Image.svelte";
	import { getEpisodeKey } from "src/utility/episodeKey";

	// #region Circumventing the forced two-way binding of the playback rate.
	class CircumentForcedTwoWayBinding {
		public playbackRate: number = $plugin.settings.defaultPlaybackRate || 1;

		public get _playbackRate() {
			return this.playbackRate;
		}
	}

	const offBinding = new CircumentForcedTwoWayBinding();
	//#endregion
	const clampVolume = (value: number): number => Math.min(1, Math.max(0, value));

	let isHoveringArtwork: boolean = false;
	let isLoading: boolean = true;
	let playerVolume: number = 1;

	function togglePlayback() {
		isPaused.update((value) => !value);
	}

	function onClickProgressbar(
		{ detail: { event, percent } }: CustomEvent<{ event: MouseEvent | KeyboardEvent; percent?: number }>
	) {
		if (typeof percent === "number") {
			currentTime.set(percent * $duration);
			return;
		}

		if (event instanceof MouseEvent) {
			const progressbar = event.currentTarget as HTMLDivElement;
			const ratio = progressbar.offsetWidth ? event.offsetX / progressbar.offsetWidth : 0;
			currentTime.set(ratio * $duration);
		}
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

		queue.remove($currentEpisode);
	}

	function onEpisodeEnded() {
		playedEpisodes.markAsPlayed($currentEpisode);
		removeEpisodeFromPlaylists();

		queue.playNext();
	}

	function onPlaybackRateChange(event: CustomEvent<{ value: number }>) {
		offBinding.playbackRate = event.detail.value;
	}

	function onVolumeChange(event: CustomEvent<{ value: number }>) {
		const newVolume = clampVolume(event.detail.value);

		volume.set(newVolume);
	}

	function onMetadataLoaded() {
		isLoading = false;

		restorePlaybackTime();
	}

	function restorePlaybackTime() {
		const playedEps = $playedEpisodes;
		const currentEp = $currentEpisode;

		if (!currentEp) {
			currentTime.set(0);
			isPaused.set(false);
			return;
		}

		const key = getEpisodeKey(currentEp);

		// Check composite key first, then fallback to title-only for backwards compat
		const playedData = (key && playedEps[key]) || playedEps[currentEp.title];

		if (playedData?.time) {
			currentTime.set(playedData.time);
		} else {
			currentTime.set(0);
		}

		isPaused.set(false);
	}

	let srcPromise: Promise<string> = getSrc($currentEpisode);

	onMount(() => {
		// This only happens when the player is open and the user downloads the episode via the context menu.
		// So we want to update the source of the audio element to local file / online stream.
		const unsubDownloadedSource = downloadedEpisodes.subscribe(_ => {
			srcPromise = getSrc($currentEpisode);
		});

		const unsubCurrentEpisode = currentEpisode.subscribe(_ => {
			srcPromise = getSrc($currentEpisode);
		});

		const unsubVolume = volume.subscribe((value) => {
			playerVolume = clampVolume(value);
		});

		return () => {
			unsubDownloadedSource();
			unsubCurrentEpisode();
			unsubVolume();
		};
	});

	onDestroy(() => {
		playedEpisodes.setEpisodeTime($currentEpisode, $currentTime, $duration, ($currentTime === $duration));
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
			markPlayed: true
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
			if (!downloadedEpisode) return '';

			return createMediaUrlObjectFromFilePath(downloadedEpisode.filePath);
		}
		
		return episode.streamUrl;
	}
</script>

	<div class="episode-player">
		<div class="episode-image-container">
			<button
				type="button"
				class="hover-container"
				on:click={togglePlayback}
				on:contextmenu={handleContextMenuEpisodeImage}
				on:mouseenter={() => (isHoveringArtwork = true)}
				on:mouseleave={() => (isHoveringArtwork = false)}
				aria-label="Toggle playback"
			>
		 <Image 
			class={"podcast-artwork"}
			src={$currentEpisode.artworkUrl ?? ""}
			alt={$currentEpisode.title}
			opacity={(isHoveringArtwork || $isPaused) ? 0.5 : 1}
		 >
			<svelte:fragment slot="fallback">
				<div class={"podcast-artwork-placeholder" + (isHoveringArtwork || $isPaused ? " opacity-50" : "")}>
					<Icon icon="image" size={150} clickable={false} />
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
					class:visible={isHoveringArtwork || $isPaused}
				>
					<Icon icon={$isPaused ? "play" : "pause"} clickable={false} />
				</div>
			{/if}
		</button>
	</div>

	<h2 class="podcast-title">{$currentEpisode.title}</h2>

	{#await srcPromise then src}
		<audio
			src={src}
			bind:duration={$duration}
			bind:currentTime={$currentTime}
			bind:paused={$isPaused}
			bind:playbackRate={offBinding._playbackRate}
			bind:volume={playerVolume}
			on:ended={onEpisodeEnded}
			on:loadedmetadata={onMetadataLoaded}
			on:play|preventDefault
			autoplay={true}
		></audio>
	{/await}

	<div class="status-container">
		<span>{formatSeconds($currentTime, "HH:mm:ss")}</span>
		<Progressbar 
			on:click={onClickProgressbar}
			value={$currentTime}
			max={$duration}
		/>
		<span>{formatSeconds($duration - $currentTime, "HH:mm:ss")}</span>
	</div>

	<div class="controls-container">
		<Button
			icon="skip-back"
			tooltip="Skip backward"
			on:click={$plugin.api.skipBackward.bind($plugin.api)}
			class="player-control-button"
		/>
		<Button
			icon="skip-forward"
			tooltip="Skip forward"
			on:click={$plugin.api.skipForward.bind($plugin.api)}
			class="player-control-button"
		/>
	</div>

	<div class="slider-stack">
		<div class="volume-container">
			<span>Volume: {Math.round(playerVolume * 100)}%</span>
			<Slider
				on:change={onVolumeChange}
				value={playerVolume}
				limits={[0, 1, 0.05]}
			/>
		</div>

		<div class="playbackrate-container">
			<span>{offBinding.playbackRate}x</span>
			<Slider
				on:change={onPlaybackRateChange}
				value={offBinding.playbackRate}
				limits={[0.5, 3.5, 0.1]}
			/>
		</div>
	</div>

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

<style>
	.episode-player {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 0 1rem;
		overflow-y: auto;
	}

	.episode-image-container {
		width: 100%;
		max-width: 20rem;
		margin: 0 auto;
		padding: 1rem 0;
	}

	.hover-container {
		width: 100%;
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
		border-radius: 0.75rem;
		overflow: hidden;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
		transition: box-shadow 200ms ease, transform 200ms ease;
	}

	.hover-container:hover {
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
	}

	.hover-container:active {
		transform: scale(0.98);
	}

	:global(.podcast-artwork) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		position: absolute;
		transition: opacity 200ms ease;
	}

	:global(.podcast-artwork-placeholder) {
		width: 100%;
		height: 100%;
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background-secondary);
		transition: opacity 200ms ease;
	}

	.podcast-artwork-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		background: rgba(0, 0, 0, 0.1);
		transition: opacity 200ms ease;
	}

	.podcast-artwork-overlay.visible {
		opacity: 1;
	}

	.podcast-artwork-isloading-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.3);
	}

	:global(.opacity-50) {
		opacity: 0.5;
	}

	.podcast-title {
		font-size: 1.125rem;
		font-weight: 600;
		line-height: 1.4;
		margin: 0 0 1rem;
		text-align: center;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.status-container {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0 0.25rem;
	}

	.status-container span {
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		min-width: 4rem;
		text-align: center;
	}

	.status-container span:first-child {
		text-align: right;
	}

	.status-container span:last-child {
		text-align: left;
	}

	:global(.episode-player .status-container .progress) {
		height: var(--episode-player-progress-height, 0.5rem);
		flex: 1 1 auto;
	}

	.controls-container {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 2rem;
		margin: 1.25rem 0;
	}

	:global(.player-control-button) {
		margin: 0;
		cursor: pointer;
		padding: 0.5rem;
		border-radius: 50%;
		transition: background-color 120ms ease;
	}

	:global(.player-control-button:hover) {
		background-color: var(--background-modifier-hover);
	}

	.slider-stack {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: auto;
		padding: 1.5rem 0;
		border-top: 1px solid var(--background-modifier-border);
	}

	.playbackrate-container,
	.volume-container {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding: 0 0.5rem;
	}

	.playbackrate-container span,
	.volume-container span {
		font-size: 0.8rem;
		color: var(--text-muted);
		min-width: 5rem;
	}

	:global(.episode-player h3) {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin: 1rem 0 0.5rem;
		padding: 0 0.5rem;
	}
</style>
