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
	import Slider from "../obsidian/Slider.svelte";
	import Loading from "./Loading.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import Progressbar from "../common/Progressbar.svelte";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import type { Episode } from "src/types/Episode";
	import { ViewState } from "src/types/ViewState";
	import { createMediaUrlObjectFromFilePath } from "src/utility/createMediaUrlObjectFromFilePath";
	import Image from "../common/Image.svelte";

	// #region Circumventing the forced two-way binding of the playback rate.
	class CircumentForcedTwoWayBinding {
		public playbackRate: number = $plugin.settings.defaultPlaybackRate || 1;

		public get _playbackRate() {
			return this.playbackRate;
		}
	}

	const offBinding = new CircumentForcedTwoWayBinding();
	//#endregion

	let isHoveringArtwork: boolean = false;
	let isLoading: boolean = true;

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
		const unsubDownloadedSource = downloadedEpisodes.subscribe(_ => {
			srcPromise = getSrc($currentEpisode);
		});

		const unsubCurrentEpisode = currentEpisode.subscribe(_ => {
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
					style={`display: ${
						isHoveringArtwork || $isPaused ? "block" : "none"
					}`}
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
			bind:currentTime={playerTime}
			bind:paused={$isPaused}
			bind:playbackRate={offBinding._playbackRate}
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
		<span>{offBinding.playbackRate}x</span>
		<Slider
			on:change={onPlaybackRateChange}
			value={offBinding.playbackRate}
			limits={[0.5, 3.5, 0.1]}
		/>
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
	:global(.episode-player) {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	:global(.episode-image-container) {
		width:  100%;
		height: auto;
		padding: 5% 0%;
	}

	:global(.hover-container) {
		min-width:  10rem;
		min-height: 10rem;
		width: 100%;
		height: 100%;
		aspect-ratio: 1/1;
		display: flex;
		align-items: center;
		justify-content: center;
		position: relative;
		margin-left: auto;
		margin-right: auto;
		border: none;
		background: transparent;
		padding: 0;
		cursor: pointer;
	}

	:global(.podcast-artwork) {
		width: 100%;
		height: 100%;
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		position: absolute;
	}

	:global(.podcast-artwork-placeholder) {
		width: 100%;
		height: 100%;
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		position: absolute;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	/* Some themes override this, so opting to force like so. */
	:global(.podcast-artwork:hover) {
		cursor: pointer !important;
	}

	:global(.podcast-artwork-overlay) {
		position: absolute;
	}

	:global(.podcast-artwork-isloading-overlay) {
		position: absolute;
		display: block;
	}

	:global(.podcast-artwork-overlay:hover) {
		cursor: pointer !important;
	}

	:global(.opacity-50) {
		opacity: 0.5;
	}

	:global(.podcast-title) {
		font-size: 1.5rem;
		font-weight: bold;
		margin: 0%;
		margin-bottom: 0.5rem;
		text-align: center;
	}

	:global(.status-container) {
		display: flex;
		align-items: center;
		justify-content: space-around;
	}

	:global(.controls-container) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 1rem;
		margin-left: 25%;
		margin-right: 25%;
	}

	:global(.playbackrate-container) {
		display: flex;
		align-items: center;
		justify-content: space-around;
		margin-bottom: 2.5rem;
		flex-direction: column;
		margin-top: auto;
	}
</style>
