<script lang="ts">
	import { formatSeconds } from "src/utility/formatSeconds";
	import { fetchChapters } from "src/utility/fetchChapters";
	import { onMount } from "svelte";
	import Icon from "../obsidian/Icon.svelte";
	import Button from "../obsidian/Button.svelte";
	import Slider from "../obsidian/Slider.svelte";
	import Loading from "./Loading.svelte";
	import ChapterList from "./ChapterList.svelte";
	import Progressbar from "../common/Progressbar.svelte";
	import type { Episode } from "src/types/Episode";
	import type { Chapter } from "src/types/Chapter";
	import Image from "../common/Image.svelte";
	import { useServices } from "./context";
	import EpisodeRow from "./EpisodeRow.svelte";
	import { anchorOf, episodeMenu, openEpisode, showMenu } from "./menus";
	import { getEpisodeKey } from "src/utility/episodeKey";
	import { isEpisodeFinished } from "src/utility/episodeStatus";
	import {
		PLAYBACK_RATE_MAX,
		PLAYBACK_RATE_MIN,
		PLAYBACK_RATE_STEP,
	} from "src/utility/playbackRate";

	const services = useServices();
	const { player, api, settings, library } = services;
	const { queue, playedEpisodes, hidePlayedEpisodes } = library;
	const playerState = player.state;

	let isHoveringArtwork = $state(false);
	let root: HTMLDivElement;
	let inMainWindow = $state(true);
	let videoContainer: HTMLDivElement | undefined = $state();
	let chapters: Chapter[] = $state([]);
	let lastChaptersUrl: string | undefined = undefined;

	// Hide the player's Queue list only when queue automation is off AND the queue
	// is empty (issue #108), otherwise show it (default-on state or a non-empty
	// manual queue).
	const showQueue = $derived($settings.autoQueue !== false || $queue.episodes.length > 0);
	const queueRows = $derived(
		$hidePlayedEpisodes
			? $queue.episodes.filter((entry) => !isEpisodeFinished(entry, $playedEpisodes))
			: $queue.episodes,
	);

	const episode = $derived($playerState.episode as Episode);
	// Title length feeds the CSS length-based downscaling on .podcast-title (issue #81).
	const titleCharCount = $derived(episode.title.length);
	// The video plays in the main window, so a view in a popout shows the artwork.
	const showVideo = $derived($playerState.mediaType === "video" && inMainWindow);
	const paused = $derived($playerState.status !== "playing");
	const isLoading = $derived($playerState.status === "loading");
	const loadError = $derived(
		$playerState.status === "error" ? "Could not load this episode's media." : null,
	);
	const remaining = $derived(Math.max(0, $playerState.duration - $playerState.currentTime));

	// Clear the previous episode's chapters at once so they never flash against the
	// next one, and drop a fetch that a newer episode superseded.
	$effect.pre(() => loadChapters(episode.chaptersUrl));
	function loadChapters(chaptersUrl: string | undefined) {
		if (chaptersUrl === lastChaptersUrl) return;
		lastChaptersUrl = chaptersUrl;
		chapters = [];
		if (!chaptersUrl) return;
		void fetchChapters(chaptersUrl).then((c) => {
			if (chaptersUrl === lastChaptersUrl) chapters = c;
		});
	}

	onMount(() => {
		const follow = () => (inMainWindow = root.ownerDocument === document);
		follow();
		return root.onWindowMigrated?.(follow);
	});

	function onClickProgressbar({
		detail: { event, percent },
	}: CustomEvent<{ event: MouseEvent | KeyboardEvent; percent?: number }>) {
		if (typeof percent === "number") {
			player.seek(percent * $playerState.duration);
			return;
		}

		if (event instanceof MouseEvent) {
			const progressbar = event.currentTarget as HTMLDivElement;
			const ratio = progressbar.offsetWidth ? event.offsetX / progressbar.offsetWidth : 0;
			player.seek(ratio * $playerState.duration);
		}
	}

	function enterFullscreen() {
		// Prefer fullscreening the container so the custom overlay/controls stay
		// usable; fall back to the bare video element on iOS Safari/WKWebView,
		// where requestFullscreen on a div is unsupported and only the media
		// element itself can go fullscreen.
		if (videoContainer?.requestFullscreen) {
			void videoContainer.requestFullscreen();
			return;
		}

		const video = videoContainer?.querySelector("video") as
			| (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
			| null
			| undefined;
		if (video?.requestFullscreen) {
			void video.requestFullscreen();
		} else if (video?.webkitEnterFullscreen) {
			video.webkitEnterFullscreen();
		}
	}

	function handleContextMenuEpisodeImage(event: MouseEvent) {
		const at = anchorOf(event);
		showMenu(episodeMenu(episode, services, { place: "player", at }), at);
	}
</script>

<div class="episode-player" bind:this={root}>
	{#if showVideo}
		<div class="episode-video-container" use:player.videoStage bind:this={videoContainer}>
			{#if isLoading}
				<div class="podcast-artwork-isloading-overlay">
					<Loading />
				</div>
			{:else if loadError}
				<div class="podcast-artwork-load-error" role="alert">
					<Icon icon="alert-triangle" clickable={false} />
					<span>{loadError}</span>
				</div>
			{:else}
				<button
					type="button"
					class="podcast-video-overlay"
					class:visible={paused}
					onclick={() => player.toggle()}
					oncontextmenu={handleContextMenuEpisodeImage}
					aria-label="Toggle playback"
				>
					<Icon icon={paused ? "play" : "pause"} clickable={false} />
				</button>
			{/if}

			<button
				type="button"
				class="podcast-video-fullscreen"
				onclick={enterFullscreen}
				aria-label="Enter fullscreen"
			>
				<Icon icon="maximize" clickable={false} />
			</button>
		</div>
	{:else}
		<div class="episode-image-container">
			<button
				type="button"
				class="hover-container"
				onclick={() => player.toggle()}
				oncontextmenu={handleContextMenuEpisodeImage}
				onmouseenter={() => (isHoveringArtwork = true)}
				onmouseleave={() => (isHoveringArtwork = false)}
				aria-label="Toggle playback"
			>
				<Image
					class="podcast-artwork"
					src={episode.artworkUrl ?? ""}
					alt={episode.title}
					opacity={isHoveringArtwork || paused ? 0.5 : 1}
				>
					<svelte:fragment slot="fallback">
						<div
							class={"podcast-artwork-placeholder" +
								(isHoveringArtwork || paused ? " opacity-50" : "")}
						>
							<Icon icon="image" size={150} clickable={false} />
						</div>
					</svelte:fragment>
				</Image>

				{#if isLoading}
					<div class="podcast-artwork-isloading-overlay">
						<Loading />
					</div>
				{:else if loadError}
					<div class="podcast-artwork-load-error" role="alert">
						<Icon icon="alert-triangle" clickable={false} />
						<span>{loadError}</span>
					</div>
				{:else}
					<div
						class="podcast-artwork-overlay"
						class:visible={isHoveringArtwork || paused}
					>
						<Icon icon={paused ? "play" : "pause"} clickable={false} />
					</div>
				{/if}
			</button>
		</div>
	{/if}

	<h2 class="podcast-title" style="--title-char-count: {titleCharCount}">
		{episode.title}
	</h2>

	<div class="status-container">
		<span>{formatSeconds($playerState.currentTime, "HH:mm:ss")}</span>
		<Progressbar
			on:click={onClickProgressbar}
			value={$playerState.currentTime}
			max={$playerState.duration}
			ariaLabel="Seek within episode"
			valueText={`${formatSeconds($playerState.currentTime, "HH:mm:ss")} of ${formatSeconds($playerState.duration, "HH:mm:ss")}`}
		/>
		<span>{formatSeconds(remaining, "HH:mm:ss")}</span>
	</div>

	<div class="controls-container">
		<Button
			icon="skip-back"
			tooltip="Skip backward"
			on:click={() => api.skipBackward()}
			class="player-control-button"
		/>
		<Button
			icon="skip-forward"
			tooltip="Skip forward"
			on:click={() => api.skipForward()}
			class="player-control-button"
		/>
	</div>

	<div class="slider-stack">
		<div class="volume-container">
			<span>Volume: {Math.round($playerState.volume * 100)}%</span>
			<Slider
				on:change={(event) => player.setVolume(event.detail.value)}
				value={$playerState.volume}
				limits={[0, 1, 0.05]}
			/>
		</div>

		<div class="playbackrate-container">
			<span>{$playerState.playbackRate}x</span>
			<Slider
				on:change={(event) => player.setPlaybackRate(event.detail.value)}
				value={$playerState.playbackRate}
				limits={[PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX, PLAYBACK_RATE_STEP]}
			/>
		</div>
	</div>

	<div class="lists-container">
		<ChapterList
			{chapters}
			currentTime={$playerState.currentTime}
			on:seek={(event) => player.seek(event.detail.time)}
		/>

		{#if showQueue}
			<h3>Queue</h3>
			<div class="pn-list" role="list">
				{#each queueRows as queued (getEpisodeKey(queued))}
					<EpisodeRow
						episode={queued}
						cover
						onplay={() => openEpisode(services, queued)}
						onmenu={(at) =>
							showMenu(episodeMenu(queued, services, { place: "list", at }), at)}
					/>
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.episode-player {
		display: flex;
		flex-direction: column;
		flex: 1 1 auto;
		min-height: 0;
		padding: 0 1rem;
		padding-bottom: var(--pn-status-bar);
		overflow-y: auto;
		gap: 0.35rem;
	}

	.episode-image-container {
		width: 100%;
		max-width: 20rem;
		margin: 0 auto 0.5rem;
		padding: 1rem 0 0.5rem;
	}

	.episode-video-container {
		width: 100%;
		max-width: 32rem;
		aspect-ratio: 16 / 9;
		position: relative;
		margin: 0 auto 0.5rem;
		background: #000;
		border-radius: 0.75rem;
		overflow: hidden;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
	}

	.episode-video-container :global(video) {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: contain;
		background: #000;
	}

	/* Square by aspect-ratio: Obsidian's mobile buttons override padding. */
	.hover-container {
		box-sizing: border-box;
		width: 100%;
		height: auto;
		aspect-ratio: 1;
		display: block;
		position: relative;
		border: none;
		background: transparent;
		cursor: pointer;
		border-radius: 0.75rem;
		overflow: hidden;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
		transition:
			box-shadow 200ms ease,
			transform 200ms ease;
	}

	.hover-container:hover {
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
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
		inset: 0;
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

	.podcast-video-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		border: none;
		background: rgba(0, 0, 0, 0.1);
		color: var(--text-on-accent);
		cursor: pointer;
		transition: opacity 200ms ease;
	}

	.episode-video-container:hover .podcast-video-overlay,
	.podcast-video-overlay:focus-visible,
	.podcast-artwork-overlay.visible,
	.podcast-video-overlay.visible {
		opacity: 1;
	}

	.podcast-video-overlay:focus-visible {
		outline: 2px solid var(--background-modifier-border-focus);
		outline-offset: -4px;
	}

	.podcast-video-fullscreen {
		position: absolute;
		right: 0.5rem;
		bottom: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.35rem;
		border: none;
		border-radius: 0.375rem;
		background: rgba(0, 0, 0, 0.45);
		color: var(--text-on-accent);
		cursor: pointer;
		opacity: 0;
		transition:
			opacity 200ms ease,
			background-color 120ms ease;
	}

	.episode-video-container:hover .podcast-video-fullscreen,
	.podcast-video-fullscreen:focus-visible {
		opacity: 1;
	}

	.podcast-video-fullscreen:hover {
		background: rgba(0, 0, 0, 0.65);
	}

	.podcast-video-fullscreen:focus-visible {
		outline: 2px solid var(--background-modifier-border-focus);
		outline-offset: 2px;
	}

	.podcast-artwork-load-error {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		text-align: center;
		padding: 0.5rem;
		background-color: rgba(0, 0, 0, 0.6);
		color: var(--text-error);
		font-size: 0.85rem;
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
		/*
		 * Scale the title down as it gets longer (issue #81) so a long episode
		 * title no longer renders at one large fixed size. Titles up to ~40
		 * characters render at the 1rem base; beyond that the size eases down
		 * (0.0025rem per extra character) toward a readable 0.875rem floor,
		 * reached around ~90 characters. --title-char-count is an approximate
		 * length signal (UTF-16 code units, set from the title in the markup), so
		 * it only loosely tracks rendered width for non-Latin scripts;
		 * word-break: break-word below is what actually keeps any title contained.
		 */
		font-size: clamp(
			0.875rem,
			calc(1rem - (var(--title-char-count, 0) - 40) * 0.0025rem),
			1rem
		);
		font-weight: 600;
		line-height: 1.4;
		margin: 0 0 0.75rem;
		text-align: center;
		color: var(--text-normal);
		white-space: normal;
		word-break: break-word;
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
		padding: 1rem 0 0.75rem;
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

	.lists-container {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		padding-bottom: 0.5rem;
	}
</style>
