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
		transcriptionProgress,
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
	
	function transcribeEpisode() {
		// Call the API (the service will update store state)
		$plugin.api.transcribeCurrentEpisode();
	}
	
	function cancelTranscription() {
		if ($plugin.transcriptionService) {
			$plugin.transcriptionService.cancelTranscription();
		}
	}
	
	function resumeTranscription() {
		// Call the API (the service will update store state)
		$plugin.api.resumeTranscription();
	}
	
	// Get state directly from centralized store
	$: isTranscribing = $transcriptionProgress.isTranscribing;
	$: progressPercent = $transcriptionProgress.progressPercent;
	$: progressSize = $transcriptionProgress.progressSize;
	$: timeRemaining = $transcriptionProgress.timeRemaining;
	$: processingStatus = $transcriptionProgress.processingStatus;
	
	// Computed values from the store
	$: hasResumableTranscription = $currentEpisode && 
		$transcriptionProgress.hasResumableTranscription && 
		$transcriptionProgress.currentEpisodeId === $currentEpisode.id;
		
	$: hasExistingTranscript = $currentEpisode && 
		$transcriptionProgress.hasExistingTranscript && 
		$transcriptionProgress.currentEpisodeId === $currentEpisode.id;
	
	// When component initializes, check transcription status if needed
	onMount(() => {
		// Initial check for resumable transcription or existing transcript for current episode
		if ($currentEpisode && $plugin.transcriptionService) {
			// Update the store with current episode status
			// This ensures UI stays in sync with actual state
			const hasResumable = $plugin.transcriptionService.hasResumableTranscription($currentEpisode.id);
			const hasTranscript = $plugin.transcriptionService.hasExistingTranscript($currentEpisode.id);
			
			// Only update if needed to avoid unnecessary renders
			if (hasResumable !== $transcriptionProgress.hasResumableTranscription ||
				hasTranscript !== $transcriptionProgress.hasExistingTranscript) {
				
				transcriptionProgress.update(s => ({
					...s,
					currentEpisodeId: $currentEpisode.id,
					hasResumableTranscription: hasResumable,
					hasExistingTranscript: hasTranscript
				}));
			}
		}
	});


	const playbackRates = {
		"0.25": "0.25x",
		"0.50": "0.5x",
		"0.75": "0.75x",
		"1.00": "1x",
		"1.25": "1.25x",
		"1.50": "1.5x",
		"1.75": "1.75x",
		"2.00": "2x",
		"2.50": "2.5x",
		"3.00": "3x"
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
	
	<div class="transcript-controls">
		{#if isTranscribing}
			<div class="transcription-progress-container">
				<div class="transcription-header">
					<h3>Transcribing episode...</h3>
					<Button icon="x" tooltip="Cancel transcription" on:click={cancelTranscription} />
				</div>
				
				<div class="transcription-progress">
					<!-- Use Svelte's built-in progress element which is more reliable -->
					<progress class="progress-native" value={Math.max(0.1, progressPercent)} max="100"></progress>
					<div class="progress-stats">
						<span>{progressPercent.toFixed(1)}%</span>
						<span>{processingStatus}</span>
					</div>
				</div>
				
				<div class="transcription-details">
					<div>
						<span class="detail-value">{timeRemaining}</span>
					</div>
					<div>
						<span class="detail-label">Processed:</span>
						<span class="detail-value">{progressSize}</span>
					</div>
				</div>
			</div>
		{:else if hasResumableTranscription}
			<div class="transcript-notice">
				<div class="transcript-notice-icon">
					<Icon icon="alert-triangle" size={24} />
				</div>
				<div class="transcript-notice-content">
					<p>Transcription was interrupted</p>
					<div class="transcript-buttons">
						<Button icon="rotate-ccw" tooltip="Resume transcription" on:click={resumeTranscription}>
							Resume
						</Button>
						<Button icon="mic" tooltip="Start new transcription" on:click={transcribeEpisode}>
							New
						</Button>
					</div>
				</div>
			</div>
		{:else if !hasExistingTranscript}
			<Button icon="mic" tooltip="Transcribe this episode" on:click={transcribeEpisode}>
				Transcribe
			</Button>
		{/if}
	</div>
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
	
	.transcript-controls {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--background-modifier-border);
		display: flex;
		justify-content: center;
		align-items: center;
	}
	
	.transcript-notice {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
		padding: 0.75rem;
		background-color: var(--background-modifier-border);
		border-radius: 6px;
		width: 100%;
	}
	
	.transcript-notice-icon {
		color: var(--text-warning);
		flex-shrink: 0;
	}
	
	.transcript-notice-content {
		flex: 1;
	}
	
	.transcript-notice-content p {
		margin: 0 0 0.75rem 0;
		font-weight: 500;
	}
	
	.transcript-buttons {
		display: flex;
		gap: 0.5rem;
	}
	
	.transcription-progress-container {
		width: 100%;
		background-color: var(--background-primary);
		border-radius: 8px;
		padding: 1rem;
		box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
		border: 1px solid var(--background-modifier-border);
	}
	
	.transcription-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1rem;
	}
	
	.transcription-header h3 {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
	}
	
	.transcription-progress {
		margin-bottom: 1rem;
	}
	
	/* Native progress element styling */
	.progress-native {
		width: 100%;
		height: 0.75rem;
		margin-bottom: 0.5rem;
		appearance: none;
		-webkit-appearance: none;
		border: none;
		border-radius: 4px;
		overflow: hidden;
	}
	
	/* Styling the background */
	.progress-native::-webkit-progress-bar {
		background-color: var(--background-modifier-border);
		border-radius: 4px;
	}
	
	/* Styling the value part */
	.progress-native::-webkit-progress-value {
		background-color: var(--interactive-accent);
		border-radius: 4px;
		transition: width 0.3s ease;
	}
	
	/* Firefox support */
	.progress-native::-moz-progress-bar {
		background-color: var(--interactive-accent);
		border-radius: 4px;
		transition: width 0.3s ease;
	}
	
	.progress-stats {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		color: var(--text-muted);
	}
	
	.transcription-details {
		display: flex;
		justify-content: space-between;
		font-size: 0.85rem;
	}
	
	.detail-label {
		color: var(--text-muted);
		margin-right: 0.5rem;
	}
	
	.detail-value {
		font-weight: 500;
	}
</style>