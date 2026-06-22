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
		playbackRate,
		requestedPlaybackTime,
		activePlaybackSegment,
	} from "src/store";
	import { formatSeconds } from "src/utility/formatSeconds";
	import { fetchChapters } from "src/utility/fetchChapters";
	import { onDestroy, onMount } from "svelte";
	import Icon from "../obsidian/Icon.svelte";
	import Button from "../obsidian/Button.svelte";
	import Slider from "../obsidian/Slider.svelte";
	import Loading from "./Loading.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import ChapterList from "./ChapterList.svelte";
	import Progressbar from "../common/Progressbar.svelte";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import type { Episode, EpisodeMediaType } from "src/types/Episode";
	import type { Chapter } from "src/types/Chapter";
	import { ViewState } from "src/types/ViewState";
	import { createMediaUrlObjectFromFilePath } from "src/utility/createMediaUrlObjectFromFilePath";
	import Image from "../common/Image.svelte";
	import { episodeMatchesKey, getEpisodeKey, isSameStoredEpisode } from "src/utility/episodeKey";
	import {
		normalizePlaybackRate,
		PLAYBACK_RATE_MAX,
		PLAYBACK_RATE_MIN,
		PLAYBACK_RATE_STEP,
	} from "src/utility/playbackRate";
	import {
		getEpisodeMediaType,
		getEpisodeMediaTypeWithContainerHint,
		isSameMediaSource,
	} from "src/utility/mediaType";
	import type DownloadedEpisode from "src/types/DownloadedEpisode";

	const clampVolume = (value: number): number => Math.min(1, Math.max(0, value));

	// Hide the player's Queue list only when queue automation is off AND the queue
	// is empty (issue #108) — otherwise show it (default-on state or a non-empty
	// manual queue).
	$: showQueue =
		$plugin?.settings?.autoQueue !== false || $queue.episodes.length > 0;

	// Title length feeds the CSS length-based downscaling on .podcast-title (issue #81).
	$: titleCharCount = $currentEpisode?.title?.length ?? 0;
	type MediaSource = { mediaType: EpisodeMediaType; src: string };
	let mediaSource: MediaSource = getMediaSource($currentEpisode);
	$: mediaSource = getMediaSource($currentEpisode, $downloadedEpisodes);
	$: playerMediaType = mediaSource.mediaType;
	$: isVideoEpisode = playerMediaType === "video";

	let isHoveringArtwork: boolean = false;
	let isLoading: boolean = true;
	let playerVolume: number = 1;
	let mediaElement: HTMLMediaElement | null = null;
	// The currentEpisode subscription fires synchronously on subscribe with the
	// already-loaded episode; that first fire must not wipe a restored position
	// (or flash 0) on the initial mount. Only genuine in-player switches reset.
	let hasSeenFirstEpisodeFire: boolean = false;
	let chapters: Chapter[] = [];
	let lastChaptersUrl: string | undefined = undefined;
	let segmentStopTimeWithoutProgressSave: number | null = null;

	function togglePlayback() {
		isPaused.update((value) => !value);
	}

	function onClickProgressbar(
		{ detail: { event, percent } }: CustomEvent<{ event: MouseEvent | KeyboardEvent; percent?: number }>
	) {
		if (typeof percent === "number") {
			seekPlaybackTo(percent * $duration);
			return;
		}

		if (event instanceof MouseEvent) {
			const progressbar = event.currentTarget as HTMLDivElement;
			const ratio = progressbar.offsetWidth ? event.offsetX / progressbar.offsetWidth : 0;
			seekPlaybackTo(ratio * $duration);
		}
	}

	function removeEpisodeFromPlaylists() {
		// Match by composite identity so a same-titled episode from another podcast
		// is not removed, while a LEGACY entry saved without podcastName still
		// matches by title (isSameStoredEpisode handles both — plain composite-key
		// matching would skip those legacy entries on finish).
		playlists.update((lists) => {
			Object.values(lists).forEach((playlist) => {
				playlist.episodes = playlist.episodes.filter(
					(ep) => !isSameStoredEpisode(ep, $currentEpisode)
				);
			});

			return lists;
		});

		// The queue is title-identified everywhere (add/remove/dedupe by title; see
		// src/store/index.ts), so remove the finished episode from it by title to
		// stay consistent with that identity. The finished episode is usually already
		// gone from the queue (subscribeQueueToCurrentEpisode drops it when it became
		// current), so this is otherwise a no-op (PB-07 / Codex review #214).
		queue.remove($currentEpisode);
	}

	function onEpisodeEnded() {
		const activeSegment = $activePlaybackSegment;
		if (activeSegment && episodeMatchesKey($currentEpisode, activeSegment.episodeKey)) {
			const stopTime =
				Number.isFinite($duration) && $duration > 0
					? Math.min(activeSegment.endTime, $duration)
					: $currentTime;
			currentTime.set(stopTime);
			segmentStopTimeWithoutProgressSave = stopTime;
			activePlaybackSegment.set(null);
			isPaused.set(true);
			return;
		}

		playedEpisodes.markAsPlayed($currentEpisode);
		removeEpisodeFromPlaylists();

		queue.playNext();
	}

	function onPlaybackRateChange(event: CustomEvent<{ value: number }>) {
		playbackRate.set(normalizePlaybackRate(event.detail.value));
	}

	function onVolumeChange(event: CustomEvent<{ value: number }>) {
		const newVolume = clampVolume(event.detail.value);

		volume.set(newVolume);
	}

	function onChapterSeek(event: CustomEvent<{ time: number }>) {
		seekPlaybackTo(event.detail.time);
	}

	function enterFullscreen() {
		// Prefer fullscreening the container so the custom overlay/controls stay
		// usable; fall back to the bare <video> element on iOS Safari/WKWebView,
		// where requestFullscreen on a div is unsupported and only the media
		// element itself can go fullscreen.
		const container = mediaElement?.closest(
			".episode-video-container",
		) as HTMLElement | null;
		if (container?.requestFullscreen) {
			void container.requestFullscreen();
			return;
		}

		const video = mediaElement as
			| (HTMLMediaElement & { webkitEnterFullscreen?: () => void })
			| null;
		if (video?.requestFullscreen) {
			void video.requestFullscreen();
		} else if (video?.webkitEnterFullscreen) {
			video.webkitEnterFullscreen();
		}
	}

	function seekPlaybackTo(time: number) {
		activePlaybackSegment.set(null);
		segmentStopTimeWithoutProgressSave = null;
		currentTime.set(time);
	}

	function onMetadataLoaded() {
		isLoading = false;

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
			activePlaybackSegment.set(null);
			segmentStopTimeWithoutProgressSave = null;
			if (!episodeMatchesKey(currentEp, requestedPlayback.episodeKey)) {
				restoreSavedPlaybackTime(currentEp, playedEps);
				return;
			}

			currentTime.set(requestedPlayback.time);
			activePlaybackSegment.set(
				requestedPlayback.endTime === undefined
					? null
					: {
							episodeKey: requestedPlayback.episodeKey,
							startTime: requestedPlayback.time,
							endTime: requestedPlayback.endTime,
						},
			);
			isPaused.set(false);
			return;
		}

		activePlaybackSegment.set(null);
		segmentStopTimeWithoutProgressSave = null;
		restoreSavedPlaybackTime(currentEp, playedEps);
	}

	function restoreSavedPlaybackTime(
		currentEp: Episode,
		playedEps: typeof $playedEpisodes,
	) {
		const key = getEpisodeKey(currentEp);

		// Check composite key first, then fall back to the title-only key for
		// backwards compat — but only accept the legacy title-only entry when its
		// stored podcastName is absent or matches the current episode, so a
		// same-titled episode from another podcast can't resume at the wrong
		// position (mirrors isSamePlayedEpisode's alias logic).
		const titleOnlyData = playedEps[currentEp.title];
		const titleOnlyMatches =
			!!titleOnlyData &&
			(!titleOnlyData.podcastName ||
				!currentEp.podcastName ||
				titleOnlyData.podcastName === currentEp.podcastName);
		const playedData =
			(key && playedEps[key]) || (titleOnlyMatches ? titleOnlyData : undefined);

		if (playedData?.time) {
			currentTime.set(playedData.time);
		} else {
			currentTime.set(0);
		}

		isPaused.set(false);
	}

	// Persist playback position during playback (issue #33).
	//
	// Previously the position was written only on teardown — the player's
	// onDestroy, an episode switch (currentEpisode.set), or the episode
	// finishing. On mobile the OS kills the backgrounded process without firing
	// onDestroy, so every second listened since the last teardown was lost and
	// the episode restarted from 0 on reopen.
	//
	// Persist periodically while audio plays (throttled) and immediately when it
	// pauses, so an abrupt kill loses at most SAVE_POSITION_THROTTLE_MS of
	// progress. saveSettings already coalesces rapid writes, so this cadence
	// stays cheap.
	const SAVE_POSITION_THROTTLE_MS = 5000;
	let lastPositionSaveMs = Number.NEGATIVE_INFINITY;

	function persistPlaybackPosition() {
		// Never persist before metadata has loaded and the saved position has been
		// restored (onMetadataLoaded) — writing the pre-restore 0 would clobber the
		// stored position we are about to resume from.
		if (isLoading || !$currentEpisode) return;
		if (shouldSuppressSegmentProgressPersistence()) return;

		playedEpisodes.setEpisodeTime(
			$currentEpisode,
			$currentTime,
			$duration,
			// A zero/unknown duration is never "finished" — guard against the brief
			// 0/0 window after an episode switch (issue #94) marking it played at 0:00.
			$duration > 0 && $currentTime === $duration,
		);
	}

	function onTimeUpdate(event: Event) {
		if (stopActivePlaybackSegmentIfEnded(event)) return;

		const now = Date.now();
		if (now - lastPositionSaveMs < SAVE_POSITION_THROTTLE_MS) return;

		lastPositionSaveMs = now;
		persistPlaybackPosition();
	}

	function shouldSuppressSegmentProgressPersistence(): boolean {
		const activeSegment = $activePlaybackSegment;
		if (activeSegment && episodeMatchesKey($currentEpisode, activeSegment.episodeKey)) {
			return true;
		}

		if (segmentStopTimeWithoutProgressSave === null) return false;
		if ($currentTime === segmentStopTimeWithoutProgressSave) return true;

		segmentStopTimeWithoutProgressSave = null;
		return false;
	}

	function stopActivePlaybackSegmentIfEnded(event: Event): boolean {
		const activeSegment = $activePlaybackSegment;
		if (!activeSegment) return false;

		if (!episodeMatchesKey($currentEpisode, activeSegment.episodeKey)) {
			activePlaybackSegment.set(null);
			return false;
		}

		if ($currentTime < activeSegment.endTime) return false;

		const media = event.currentTarget as HTMLMediaElement | null;
		if (media) {
			media.currentTime = activeSegment.endTime;
		}
		currentTime.set(activeSegment.endTime);
		segmentStopTimeWithoutProgressSave = activeSegment.endTime;
		activePlaybackSegment.set(null);
		isPaused.set(true);
		return true;
	}

	function onPause() {
		// An explicit stop is the moment the user is most likely to leave the app,
		// so capture the exact position immediately rather than waiting for the
		// next throttled tick.
		persistPlaybackPosition();
	}

	onMount(() => {
		const unsubCurrentEpisode = currentEpisode.subscribe((episode) => {
			// Re-arm the load guard and throttle for the incoming episode. isLoading
			// is cleared once on the first loadedmetadata and this component instance
			// is reused across in-player switches (no {#key} around <EpisodePlayer/>),
			// so without this it would stay false — letting a pause/timeupdate during
			// the src swap persist the new episode under its key with the old/zero
			// time and clobber its saved resume position (issue #33).
			isLoading = true;
			lastPositionSaveMs = Number.NEGATIVE_INFINITY;
			segmentStopTimeWithoutProgressSave = null;

			// Clear the outgoing episode's progress the instant the episode changes
			// so the player never renders its full/last position against the
			// incoming episode while the new media's metadata loads (issue #94).
			// Finishing an episode auto-advances by calling currentEpisode.set (see
			// queue.playNext), which swaps the title/artwork immediately — but
			// $currentTime/$duration keep the finished episode's end values until
			// the next episode's loadedmetadata fires. Without this reset the
			// progress bar stays pinned at 100% and the timestamps show the
			// previous episode's end for the whole (network-bound) metadata fetch.
			// onMetadataLoaded → restorePlaybackTime sets the real position, and
			// the isLoading guard above keeps this reset from being persisted.
			if (hasSeenFirstEpisodeFire) {
				currentTime.set(0);
				duration.set(0);
			}
			hasSeenFirstEpisodeFire = true;

			// Fetch chapters when episode changes. Clear the previous episode's
			// chapters immediately so they never flash against the incoming
			// episode while the new fetch is in flight, and drop superseded /
			// out-of-order fetch results by checking the request is still latest.
			const chaptersUrl = episode?.chaptersUrl;
			if (chaptersUrl && chaptersUrl !== lastChaptersUrl) {
				lastChaptersUrl = chaptersUrl;
				chapters = [];
				const requestedUrl = chaptersUrl;
				fetchChapters(requestedUrl).then((c) => {
					if (requestedUrl === lastChaptersUrl) {
						chapters = c;
					}
				});
			} else if (!chaptersUrl) {
				lastChaptersUrl = undefined;
				chapters = [];
			}
		});

		const unsubVolume = volume.subscribe((value) => {
			playerVolume = clampVolume(value);
		});

		// Backgrounding the app (mobile home button / app switch) or hiding the
		// window is the last reliable moment before the OS may suspend or kill the
		// process. It fires no pause event when audio keeps playing, and the next
		// throttled tick may never arrive — so persist immediately on hide to make
		// progress durable in exactly the scenario issue #33 reports.
		const onVisibilityChange = () => {
			if (document.visibilityState === "hidden") {
				persistPlaybackPosition();
			}
		};
		document.addEventListener("visibilitychange", onVisibilityChange);

		return () => {
			unsubCurrentEpisode();
			unsubVolume();
			document.removeEventListener("visibilitychange", onVisibilityChange);
		};
	});

	onDestroy(() => {
		persistPlaybackPosition();
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

	function getMediaSource(
		episode: Episode | undefined,
		downloaded: typeof $downloadedEpisodes = {},
	): MediaSource {
		if (!episode) return { src: "", mediaType: "audio" };

		const downloadedEpisode = findDownloadedEpisode(episode, downloaded);
		if (shouldUseDownloadedEpisode(episode, downloadedEpisode)) {
			return {
				src: createMediaUrlObjectFromFilePath(downloadedEpisode.filePath),
				mediaType: getDownloadedEpisodeMediaType(episode, downloadedEpisode),
			};
		}

		return {
			src: episode.streamUrl,
			mediaType: getEpisodeMediaType(episode),
		};
	}

	function findDownloadedEpisode(
		episode: Episode,
		downloaded: typeof $downloadedEpisodes,
	): DownloadedEpisode | undefined {
		return downloaded[episode.podcastName]?.find(
			(downloadedEpisode) => downloadedEpisode.title === episode.title,
		);
	}

	function shouldUseDownloadedEpisode(
		episode: Episode,
		downloadedEpisode: DownloadedEpisode | undefined,
	): downloadedEpisode is DownloadedEpisode {
		if (!downloadedEpisode?.filePath) return false;

		const downloadedMediaType = getDownloadedEpisodeMediaType(
			episode,
			downloadedEpisode,
		);
		if (episode.mediaType && downloadedMediaType !== episode.mediaType) {
			return false;
		}

		if (episode.podcastName === "local file") {
			const filePath = (episode as Partial<DownloadedEpisode>).filePath;
			return !filePath || downloadedEpisode.filePath === filePath;
		}

		return isSameMediaSource(downloadedEpisode.streamUrl, episode.streamUrl);
	}

	function getDownloadedEpisodeMediaType(
		episode: Episode,
		downloadedEpisode: DownloadedEpisode,
	): EpisodeMediaType {
		return getEpisodeMediaTypeWithContainerHint(
			downloadedEpisode,
			episode.mediaType,
		);
	}

	$: if (mediaElement && mediaElement.playbackRate !== $playbackRate) {
		mediaElement.playbackRate = $playbackRate;
	}
</script>

<div class="episode-player">
	{#if isVideoEpisode}
		<div class="episode-video-container">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video
				class="podcast-video"
				bind:this={mediaElement}
				src={mediaSource.src}
				bind:duration={$duration}
				bind:currentTime={$currentTime}
				bind:paused={$isPaused}
				bind:volume={playerVolume}
				on:ended={onEpisodeEnded}
				on:loadedmetadata={onMetadataLoaded}
				on:timeupdate={onTimeUpdate}
				on:pause={onPause}
				on:play|preventDefault
				aria-label={$currentEpisode.title}
				playsinline
				autoplay={true}
			></video>

			{#if isLoading}
				<div class="podcast-artwork-isloading-overlay">
					<Loading />
				</div>
			{:else}
				<button
					type="button"
					class="podcast-video-overlay"
					class:visible={$isPaused}
					on:click={togglePlayback}
					on:contextmenu={handleContextMenuEpisodeImage}
					aria-label="Toggle playback"
				>
					<Icon icon={$isPaused ? "play" : "pause"} clickable={false} />
				</button>
			{/if}

			<button
				type="button"
				class="podcast-video-fullscreen"
				on:click={enterFullscreen}
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
				on:click={togglePlayback}
				on:contextmenu={handleContextMenuEpisodeImage}
				on:mouseenter={() => (isHoveringArtwork = true)}
				on:mouseleave={() => (isHoveringArtwork = false)}
				aria-label="Toggle playback"
			>
				<Image
					class="podcast-artwork"
					src={$currentEpisode.artworkUrl ?? ""}
					alt={$currentEpisode.title}
					opacity={isHoveringArtwork || $isPaused ? 0.5 : 1}
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
	{/if}

	<h2 class="podcast-title" style="--title-char-count: {titleCharCount}">{$currentEpisode.title}</h2>

	{#if !isVideoEpisode}
		<audio
			bind:this={mediaElement}
			src={mediaSource.src}
			bind:duration={$duration}
			bind:currentTime={$currentTime}
			bind:paused={$isPaused}
			bind:volume={playerVolume}
			on:ended={onEpisodeEnded}
			on:loadedmetadata={onMetadataLoaded}
			on:timeupdate={onTimeUpdate}
			on:pause={onPause}
			on:play|preventDefault
			autoplay={true}
		></audio>
	{/if}

	<div class="status-container">
		<span>{formatSeconds($currentTime, "HH:mm:ss")}</span>
		<Progressbar
			on:click={onClickProgressbar}
			value={$currentTime}
			max={$duration}
			ariaLabel="Seek within episode"
			valueText={`${formatSeconds($currentTime, "HH:mm:ss")} of ${formatSeconds($duration, "HH:mm:ss")}`}
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
			<span>{$playbackRate}x</span>
			<Slider
				on:change={onPlaybackRateChange}
				value={$playbackRate}
				limits={[PLAYBACK_RATE_MIN, PLAYBACK_RATE_MAX, PLAYBACK_RATE_STEP]}
			/>
		</div>
	</div>

	<div class="lists-container">
		<ChapterList
			{chapters}
			currentTime={$currentTime}
			on:seek={onChapterSeek}
		/>

		{#if showQueue}
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

	.podcast-video {
		width: 100%;
		height: 100%;
		display: block;
		object-fit: contain;
		background: #000;
	}

	.hover-container {
		width: 100%;
		height: 0;
		padding-bottom: 100%;
		display: block;
		position: relative;
		border: none;
		background: transparent;
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
		transition: opacity 200ms ease, background-color 120ms ease;
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
</style>
