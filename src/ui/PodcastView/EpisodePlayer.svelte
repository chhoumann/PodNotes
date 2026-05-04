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
		requestedPlaybackTime,
	} from "src/store";
	import { formatSeconds } from "src/utility/formatSeconds";
	import { fetchChapters } from "src/utility/fetchChapters";
	import { onDestroy, onMount } from "svelte";
	import Icon from "../obsidian/Icon.svelte";
	import Button from "../obsidian/Button.svelte";
	import Loading from "./Loading.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import ChapterList from "./ChapterList.svelte";
	import Progressbar from "../common/Progressbar.svelte";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import type { Episode } from "src/types/Episode";
	import type { Chapter } from "src/types/Chapter";
	import { ViewState } from "src/types/ViewState";
	import { createMediaUrlObjectFromFilePath } from "src/utility/createMediaUrlObjectFromFilePath";
	import Image from "../common/Image.svelte";
	import { episodeMatchesKey, getEpisodeKey } from "src/utility/episodeKey";

	// #region Circumventing the forced two-way binding of the playback rate.
	class CircumentForcedTwoWayBinding {
		public playbackRate: number = $plugin.settings.defaultPlaybackRate || 1;

		public get _playbackRate() {
			return this.playbackRate;
		}

		public set _playbackRate(_: number) {
			// No-op: prevent two-way binding from overwriting our value
		}
	}

	const offBinding = new CircumentForcedTwoWayBinding();
	//#endregion
	const clampVolume = (value: number): number => Math.min(1, Math.max(0, value));

	let isHoveringArtwork: boolean = false;
	let isLoading: boolean = true;
	let hasRestoredPlaybackTime: boolean = false;
	let playerVolume: number = 1;
	let chapters: Chapter[] = [];
	let lastChaptersUrl: string | undefined = undefined;
	let currentTimeText: string = "00:00:00";
	let remainingTimeText: string = "--:--:--";
	let progressDuration: number = 1;
	let progressTime: number = 0;

	$: progressDuration = Number.isFinite($duration) && $duration > 0 ? $duration : 1;
	$: progressTime = Number.isFinite($currentTime) && $currentTime > 0 ? $currentTime : 0;
	$: currentTimeText = formatSeconds(progressTime, "HH:mm:ss");
	$: remainingTimeText =
		Number.isFinite($duration) && $duration > 0
			? formatSeconds(Math.max(0, $duration - progressTime), "HH:mm:ss")
			: "--:--:--";

	function togglePlayback() {
		isPaused.update((value) => !value);
	}

	function onClickProgressbar(
		{ detail: { event, percent } }: CustomEvent<{ event: MouseEvent | KeyboardEvent; percent?: number }>
	) {
		if (!Number.isFinite($duration) || $duration <= 0) return;

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

	function onPlaybackRateInput(event: Event) {
		offBinding.playbackRate = Number((event.currentTarget as HTMLInputElement).value);
	}

	function onVolumeInput(event: Event) {
		const newVolume = clampVolume(Number((event.currentTarget as HTMLInputElement).value));
		volume.set(newVolume);
	}

	function onChapterSeek(event: CustomEvent<{ time: number }>) {
		currentTime.set(event.detail.time);
	}

	function onMetadataLoaded() {
		finishAudioLoading(true);
	}

	function onAudioCanPlay() {
		finishAudioLoading();
	}

	function onAudioError() {
		finishAudioLoading();
	}

	function finishAudioLoading(shouldRestorePlaybackTime: boolean = false) {
		isLoading = false;

		if (!shouldRestorePlaybackTime || hasRestoredPlaybackTime) return;

		hasRestoredPlaybackTime = true;
		restorePlaybackTime();
	}

	function restorePlaybackTime() {
		const playedEps = $playedEpisodes;
		const currentEp = $currentEpisode;
		const requestedPlayback = $requestedPlaybackTime;

		if (!currentEp) {
			currentTime.set(0);
			isPaused.set(false);
			return;
		}

		if (requestedPlayback !== null) {
			requestedPlaybackTime.set(null);
			if (!episodeMatchesKey(currentEp, requestedPlayback.episodeKey)) {
				restoreSavedPlaybackTime(currentEp, playedEps);
				return;
			}

			currentTime.set(requestedPlayback.time);
			isPaused.set(false);
			return;
		}

		restoreSavedPlaybackTime(currentEp, playedEps);
	}

	function restoreSavedPlaybackTime(
		currentEp: Episode,
		playedEps: typeof $playedEpisodes,
	) {
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

		const unsubCurrentEpisode = currentEpisode.subscribe((episode) => {
			isLoading = true;
			hasRestoredPlaybackTime = false;
			srcPromise = getSrc($currentEpisode);

			// Fetch chapters when episode changes
			const chaptersUrl = episode?.chaptersUrl;
			if (chaptersUrl && chaptersUrl !== lastChaptersUrl) {
				lastChaptersUrl = chaptersUrl;
				fetchChapters(chaptersUrl).then((c) => {
					chapters = c;
				});
			} else if (!chaptersUrl) {
				lastChaptersUrl = undefined;
				chapters = [];
			}
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
		const safeDuration = Number.isFinite($duration) && $duration > 0 ? $duration : 0;
		const safeCurrentTime = Number.isFinite($currentTime) && $currentTime > 0 ? $currentTime : 0;
		playedEpisodes.setEpisodeTime(
			$currentEpisode,
			safeCurrentTime,
			safeDuration,
			safeDuration > 0 && safeCurrentTime === safeDuration,
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
	<div class="now-playing-panel">
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

		<div class="now-playing-details">
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
					on:canplay={onAudioCanPlay}
					on:error={onAudioError}
					on:loadedmetadata={onMetadataLoaded}
					on:play|preventDefault
					autoplay={true}
				></audio>
			{/await}

			<div class="status-container">
				<span>{currentTimeText}</span>
				<Progressbar 
					on:click={onClickProgressbar}
					value={progressTime}
					max={progressDuration}
				/>
				<span>{remainingTimeText}</span>
			</div>

			<div class="controls-container">
				<Button
					icon="skip-back"
					tooltip="Skip backward"
					on:click={$plugin.api.skipBackward.bind($plugin.api)}
					class="player-control-button"
				/>
				<Button
					icon={$isPaused ? "play" : "pause"}
					tooltip={$isPaused ? "Play" : "Pause"}
					on:click={togglePlayback}
					class="player-control-button player-play-button"
				/>
				<Button
					icon="skip-forward"
					tooltip="Skip forward"
					on:click={$plugin.api.skipForward.bind($plugin.api)}
					class="player-control-button"
				/>
			</div>
		</div>
	</div>

	<div class="slider-stack">
		<div class="volume-container">
			<span>Volume: {Math.round(playerVolume * 100)}%</span>
			<input
				class="native-slider"
				type="range"
				min="0"
				max="1"
				step="0.05"
				value={playerVolume}
				aria-label="Volume"
				on:input={onVolumeInput}
			/>
		</div>

		<div class="playbackrate-container">
			<span>{offBinding.playbackRate}x</span>
			<input
				class="native-slider"
				type="range"
				min="0.5"
				max="3.5"
				step="0.1"
				value={offBinding.playbackRate}
				aria-label="Playback rate"
				on:input={onPlaybackRateInput}
			/>
		</div>
	</div>

	<div class="lists-container">
		<ChapterList
			{chapters}
			currentTime={$currentTime}
			on:seek={onChapterSeek}
		/>

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
</div>

<style>
	.episode-player {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		padding: 0.75rem 1rem 1rem;
		overflow-y: auto;
		overflow-x: hidden;
		gap: 0.75rem;
	}

	.now-playing-panel {
		display: grid;
		grid-template-columns: 7rem minmax(0, 1fr);
		align-items: center;
		gap: 1rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.episode-image-container {
		width: 7rem;
		max-width: 7rem;
		margin: 0;
		padding: 0;
	}

	.now-playing-details {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		min-width: 0;
	}

	.hover-container {
		width: 7rem;
		height: 7rem;
		padding: 0;
		display: block;
		position: relative;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 0.625rem;
		overflow: hidden;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.18);
		transition: box-shadow 200ms ease, transform 200ms ease;
	}

	.hover-container:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
	}

	.hover-container:active {
		transform: scale(0.98);
	}

	.hover-container :global(.pn_image_container) {
		position: absolute;
		inset: 0;
	}

	:global(.podcast-artwork) {
		width: 100%;
		height: 100%;
		object-fit: cover;
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
		line-height: 1.3;
		margin: 0;
		text-align: left;
		color: var(--text-normal);
		white-space: normal;
		word-break: break-word;
	}

	.status-container {
		display: grid;
		grid-template-columns: 4.25rem minmax(0, 1fr) 4.25rem;
		align-items: center;
		gap: 0.625rem;
		padding: 0;
		min-width: 0;
		overflow: hidden;
	}

	.status-container span {
		font-size: 0.8rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-muted);
		min-width: 0;
		text-align: center;
		white-space: nowrap;
		overflow: hidden;
	}

	.status-container span:first-child {
		text-align: right;
	}

	.status-container span:last-child {
		text-align: left;
	}

	:global(.episode-player .status-container .progress) {
		height: var(--episode-player-progress-height, 0.5rem);
		width: 100%;
		min-width: 0;
	}

	.controls-container {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		gap: 0.375rem;
		margin: 0;
	}

	:global(.player-control-button) {
		margin: 0;
		cursor: pointer;
		width: 2rem;
		height: 2rem;
		min-height: 2rem;
		padding: 0;
		border-radius: 0.375rem;
		box-shadow: none !important;
		transition: background-color 120ms ease;
	}

	:global(.player-play-button) {
		color: var(--text-accent);
		background-color: var(--background-modifier-hover);
	}

	:global(.player-control-button:hover) {
		background-color: var(--background-modifier-hover);
	}

	.slider-stack {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem 1rem;
		padding: 0;
	}

	.playbackrate-container,
	.volume-container {
		display: grid;
		grid-template-columns: 5.75rem minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
		padding: 0;
		min-width: 0;
	}

	.playbackrate-container span,
	.volume-container span {
		font-size: 0.8rem;
		color: var(--text-muted);
		min-width: 0;
		white-space: nowrap;
	}

	.native-slider {
		width: 100%;
		min-width: 0;
		accent-color: var(--interactive-accent);
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

	:global(.episode-player .episode-list-view-container) {
		height: auto;
		overflow: visible;
	}

	:global(.episode-player .podcast-episode-list) {
		flex: 0 0 auto;
		overflow: visible;
	}

	.lists-container {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-bottom: 0.5rem;
	}

	:global(.lists-container .episode-list-view-container) {
		height: auto;
	}

	@media (max-width: 520px) {
		.now-playing-panel {
			grid-template-columns: 1fr;
			justify-items: center;
		}

		.episode-image-container {
			width: 10rem;
			max-width: 10rem;
		}

		.hover-container {
			width: 10rem;
			height: 10rem;
		}

		.now-playing-details {
			width: 100%;
		}

		.podcast-title {
			text-align: center;
		}

		.controls-container {
			justify-content: center;
		}

		.slider-stack {
			grid-template-columns: 1fr;
		}
	}
</style>
