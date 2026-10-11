<script lang="ts">
	import PodcastGrid from "./PodcastGrid.svelte";
	import {
		currentEpisode,
		savedFeeds,
		episodeListLimit,
		playlists,
		queue,
		favorites,
		localFiles,
		podcastView,
		viewState,
		downloadedEpisodes,
		plugin,
		playedEpisodes,
	} from "src/store";
	import EpisodePlayer from "./EpisodePlayer.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import type { Episode } from "src/types/Episode";
	import TopBar from "./TopBar.svelte";
	import { ViewState } from "src/types/ViewState";
	import { onMount } from "svelte";
	import EpisodeListHeader from "./EpisodeListHeader.svelte";
	import Icon from "../obsidian/Icon.svelte";
	import { debounce, Notice } from "obsidian";
	import searchEpisodes from "src/utility/searchEpisodes";
	import type { Playlist } from "src/types/Playlist";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import { get } from "svelte/store";
	import { PLAYED_SETTINGS } from "src/constants";
	import {
		getFinishedPlayedEpisodeRecords,
		type PlayedEpisodeMap,
	} from "src/utility/episodeStatus";
	import {
		buildPlayedEpisodeListEntries,
		createPlayedEpisodePlaceholder,
		type EpisodeListEntry,
		type PlayedEpisodeListEntry,
	} from "src/utility/episodeListEntry";
	import type { FeedKey, FeedState, LoadMode } from "src/services/FeedRepository";
	import { notifyPrivateFeedUnavailable } from "src/services/privateFeeds";
	import {
		feedKeysWithPlayedEpisodes,
		selectFeedEpisodes,
		selectLatestEpisodes,
		type Selection,
	} from "./episodeListSelection";

	const feeds = get(plugin).feeds;
	let selection: Selection = { kind: "latest" };
	let currentSearchQuery: string = "";

	onMount(() => savedFeeds.subscribe(() => void feeds.ensureAll()));

	// Hide the Queue tile only when queue automation is off AND the queue is
	// empty (issue #108), so turning the queue off doesn't leave a permanent
	// empty "Queue" tile. The default-on state and a non-empty manual queue
	// both keep it visible.
	$: displayedPlaylists = [
		...($plugin?.settings?.autoQueue !== false || $queue.episodes.length > 0 ? [$queue] : []),
		$favorites,
		$localFiles,
		getPlayedPlaylist($playedEpisodes),
		...Object.values($playlists),
	];

	let selectedFeed: FeedState | undefined;
	let selectedPlaylist: Playlist | undefined;
	$: {
		selectedFeed = selection.kind === "feed" ? $feeds.get(selection.key) : undefined;
		const name = selection.kind === "playlist" ? selection.name : undefined;
		selectedPlaylist = [$queue, $favorites, $localFiles, ...Object.values($playlists)].find(
			(playlist) => playlist.name === name,
		);
		// A podcast or playlist removed while open falls back to Latest Episodes.
		if (
			(selection.kind === "feed" && !selectedFeed) ||
			(selection.kind === "playlist" && !selectedPlaylist)
		) {
			selection = { kind: "latest" };
		}
	}
	$: headerPlaylist = selection.kind === "played" ? PLAYED_SETTINGS : selectedPlaylist;

	$: latestEpisodes = selectLatestEpisodes($feeds, Object.keys($savedFeeds), $episodeListLimit);
	$: shownEpisodes = selectedFeed
		? selectFeedEpisodes(selectedFeed, $downloadedEpisodes)
		: (selectedPlaylist?.episodes ?? latestEpisodes);
	$: displayedEpisodeEntries =
		selection.kind === "played"
			? filterPlayedEntries(
					buildPlayedEpisodeListEntries($playedEpisodes, [
						...Array.from($feeds.values(), ({ episodes }) => episodes),
						...Object.values($downloadedEpisodes),
						$queue.episodes,
						$favorites.episodes,
						$localFiles.episodes,
						...Object.values($playlists).map(({ episodes }) => episodes),
					]),
					currentSearchQuery,
				)
			: null;
	$: displayedEpisodes = displayedEpisodeEntries
		? displayedEpisodeEntries.map(({ episode }) => episode)
		: searchEpisodes(currentSearchQuery, shownEpisodes);

	// Exclude the selected feed from the banner: its loading state is already
	// shown by the inline EpisodeList spinner, so the banner would duplicate it.
	$: bannerFeedNames = Array.from($feeds.values())
		.filter((state) => state.status === "loading" && state !== selectedFeed)
		.map(({ feed }) => feed.title);
	$: loadingFeedSummary =
		bannerFeedNames.length > 3
			? `${bannerFeedNames.slice(0, 3).join(", ")} +${bannerFeedNames.length - 3} more`
			: bannerFeedNames.join(", ");

	function getPlayedPlaylist(played: PlayedEpisodeMap): Playlist {
		return {
			...PLAYED_SETTINGS,
			episodes: getFinishedPlayedEpisodeRecords(played).map(({ episode }) =>
				createPlayedEpisodePlaceholder(episode),
			),
			isVirtual: true,
		};
	}

	function filterPlayedEntries(
		entries: PlayedEpisodeListEntry[],
		query: string,
	): PlayedEpisodeListEntry[] {
		if (!query) return entries;

		const entriesByEpisode = new Map(entries.map((entry) => [entry.episode, entry]));

		return searchEpisodes(
			query,
			entries.map((entry) => entry.episode),
		)
			.map((episode) => entriesByEpisode.get(episode))
			.filter((entry): entry is PlayedEpisodeListEntry => Boolean(entry));
	}

	function showLatestEpisodes() {
		selection = { kind: "latest" };
		viewState.set(ViewState.EpisodeList);
	}

	function getPlayedEpisodeKey(entry: EpisodeListEntry): string | undefined {
		if (!("playedEpisodeKey" in entry)) return undefined;

		return typeof entry.playedEpisodeKey === "string" ? entry.playedEpisodeKey : undefined;
	}

	// Only an interactive load reports a failure. A network failure is reported
	// only when nothing can be shown.
	async function loadSelectedFeed(key: FeedKey, mode: LoadMode) {
		await feeds.load([key], mode);
		const state = get(feeds).get(key);
		if (state?.error === "unavailable") {
			notifyPrivateFeedUnavailable(state.feed.title);
		} else if (
			state?.error === "network" &&
			selectFeedEpisodes(state, get(downloadedEpisodes)).length === 0
		) {
			new Notice(
				`Could not load episodes for ${state.feed.title}. Check your connection and try again.`,
			);
		}
	}

	function handleClickPodcast(event: CustomEvent<{ key: FeedKey }>) {
		const { key } = event.detail;
		selection = { kind: "feed", key };
		viewState.set(ViewState.EpisodeList);
		void loadSelectedFeed(key, "complete");
	}

	function handleClickEpisode(event: CustomEvent<{ episode: Episode; entry: EpisodeListEntry }>) {
		const { episode, entry } = event.detail;
		if (!entry.isAvailable) {
			new Notice("This played episode is no longer available in current feeds.");
			return;
		}

		currentEpisode.set(episode);

		viewState.set(ViewState.Player);
	}

	function handleContextMenuEpisode({
		detail: { event, episode, entry },
	}: CustomEvent<{ episode: Episode; entry: EpisodeListEntry; event: MouseEvent }>) {
		spawnEpisodeContextMenu(
			episode,
			event,
			entry.isAvailable
				? undefined
				: {
						play: true,
						download: true,
						createNote: true,
						favorite: true,
						queue: true,
						playlists: true,
					},
			getPlayedEpisodeKey(entry),
		);
	}

	function handleClickRefresh() {
		if (selection.kind === "feed") {
			void loadSelectedFeed(selection.key, "network");
		} else if (selection.kind === "played") {
			void feeds.load(feedKeysWithPlayedEpisodes($savedFeeds, $playedEpisodes), "network");
		} else if (selection.kind === "latest") {
			void feeds.load($feeds.keys(), "network");
		}
	}

	const handleSearch = debounce((event: CustomEvent<{ query: string }>) => {
		currentSearchQuery = event.detail.query;
	}, 250);

	function handleClickPlaylist(event: CustomEvent<{ event: MouseEvent; playlist: Playlist }>) {
		const { playlist } = event.detail;

		if (playlist.isVirtual && playlist.name === PLAYED_SETTINGS.name) {
			selection = { kind: "played" };
			viewState.set(ViewState.EpisodeList);
			void feeds.load(feedKeysWithPlayedEpisodes($savedFeeds, $playedEpisodes), "complete");
			return;
		}

		if (playlist.name === $queue.name && $queue.episodes.length > 0) {
			selection = { kind: "latest" };
			// Only need to set the current episode if there isn't any.
			// The current episode _is_ the front of the queue.
			if (!$currentEpisode) {
				currentEpisode.set($queue.episodes[0]);
			}

			viewState.set(ViewState.Player);
		} else {
			selection = { kind: "playlist", name: playlist.name };
			viewState.set(ViewState.EpisodeList);
		}
	}
</script>

<div class="podcast-view" bind:this={$podcastView}>
	<TopBar
		bind:viewState={$viewState}
		canShowEpisodeList={true}
		canShowPlayer={!!$currentEpisode}
	/>

	{#if $viewState === ViewState.Player}
		<EpisodePlayer />
	{:else if $viewState === ViewState.EpisodeList}
		{#if bannerFeedNames.length > 0}
			<div class="feed-loading-banner">
				<div class="feed-loading-spinner">
					<Icon icon="loader-2" size={18} clickable={false} />
				</div>
				<div class="feed-loading-text">
					<span>
						Updating {bannerFeedNames.length} feed{bannerFeedNames.length === 1
							? ""
							: "s"}
					</span>
					{#if loadingFeedSummary}
						<span class="feed-loading-names">{loadingFeedSummary}</span>
					{/if}
				</div>
			</div>
		{/if}
		<EpisodeList
			episodes={displayedEpisodes}
			episodeEntries={displayedEpisodeEntries}
			showThumbnails={selection.kind !== "playlist"}
			showPlayedToggle={selection.kind !== "played"}
			alwaysShowPlayedEpisodes={selection.kind === "played"}
			isLoading={selectedFeed
				? selectedFeed.status === "loading"
				: bannerFeedNames.length > 0}
			on:clickEpisode={handleClickEpisode}
			on:contextMenuEpisode={handleContextMenuEpisode}
			on:clickRefresh={handleClickRefresh}
			on:search={handleSearch}
		>
			<svelte:fragment slot="header">
				{#if selectedFeed}
					<button type="button" class="go-back" on:click={showLatestEpisodes}>
						<Icon icon={"arrow-left"} size={20} clickable={false} /> Latest Episodes
					</button>
					<EpisodeListHeader
						text={selectedFeed.feed.title}
						artworkUrl={selectedFeed.feed.artworkUrl}
					/>
				{:else if headerPlaylist}
					<button type="button" class="go-back" on:click={showLatestEpisodes}>
						<Icon icon={"arrow-left"} size={20} clickable={false} /> Latest Episodes
					</button>
					<div class="playlist-header-icon">
						<Icon icon={headerPlaylist.icon} size={40} clickable={false} />
					</div>
					<EpisodeListHeader text={headerPlaylist.name} />
				{:else}
					<EpisodeListHeader text="Latest Episodes" />
				{/if}
			</svelte:fragment>
		</EpisodeList>
	{:else if $viewState === ViewState.PodcastGrid}
		<PodcastGrid
			feeds={Object.entries($savedFeeds)}
			playlists={displayedPlaylists}
			on:clickPodcast={handleClickPodcast}
			on:clickPlaylist={handleClickPlaylist}
		/>
	{/if}
</div>

<style>
	.podcast-view {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
	}

	.feed-loading-banner {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
		box-sizing: border-box;
	}

	.feed-loading-spinner {
		display: inline-flex;
		color: var(--interactive-accent);
		animation: spin 1s linear infinite;
	}

	.feed-loading-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: 0.85rem;
		color: var(--text-normal);
	}

	.feed-loading-names {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}

		to {
			transform: rotate(360deg);
		}
	}

	.go-back {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.625rem;
		margin: 0.5rem 0.5rem 0;
		font-size: 0.85rem;
		color: var(--text-muted);
		cursor: pointer;
		background: none;
		border: none;
		border-radius: 0.25rem;
		transition:
			color 120ms ease,
			background-color 120ms ease;
	}

	.go-back:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.go-back:active {
		background: var(--background-modifier-border);
	}

	.playlist-header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		color: var(--text-muted);
	}
</style>
