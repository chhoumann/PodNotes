<script lang="ts">
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import PodcastGrid from "./PodcastGrid.svelte";
	import {
		currentEpisode,
		savedFeeds,
		episodeCache,
		latestEpisodes as latestEpisodesStore,
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
	import FeedParser from "src/parser/feedParser";
	import TopBar from "./TopBar.svelte";
	import { ViewState } from "src/types/ViewState";
	import { onMount, onDestroy } from "svelte";
	import EpisodeListHeader from "./EpisodeListHeader.svelte";
	import Icon from "../obsidian/Icon.svelte";
	import { debounce, Notice } from "obsidian";
	import searchEpisodes from "src/utility/searchEpisodes";
	import type { Playlist } from "src/types/Playlist";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import {
		getCachedEpisodes,
		setCachedEpisodes,
	} from "src/services/FeedCacheService";
	import { get } from "svelte/store";
	import { PLAYED_SETTINGS } from "src/constants";
	import { getFinishedPlayedEpisodeRecords } from "src/utility/episodeStatus";
	import {
		buildPlayedEpisodeListEntries,
		createPlayedEpisodePlaceholder,
		type EpisodeListEntry,
		type PlayedEpisodeListEntry,
	} from "src/utility/episodeListEntry";

	let feeds: PodcastFeed[] = [];
	let selectedFeed: PodcastFeed | null = null;
	let selectedPlaylist: Playlist | null = null;
	let isShowingPlayedEpisodes: boolean = false;
	let displayedEpisodes: Episode[] = [];
	let displayedEpisodeEntries: EpisodeListEntry[] | null = null;
	let displayedPlaylists: Playlist[] = [];
	let latestEpisodes: Episode[] = [];
	let isFetchingEpisodes: boolean = false;
	let loadingFeeds: Set<string> = new Set();
	let currentSearchQuery: string = "";
	let loadingFeedNames: string[] = [];
	let loadingFeedSummary: string = "";
	let isMounted: boolean = true;

	onDestroy(() => {
		isMounted = false;
	});

	$: loadingFeedNames = Array.from(loadingFeeds);
	$: loadingFeedSummary =
		loadingFeedNames.length > 3
			? `${loadingFeedNames.slice(0, 3).join(", ")} +${loadingFeedNames.length - 3} more`
			: loadingFeedNames.join(", ");
	$: isFetchingEpisodes = loadingFeedNames.length > 0;

	onMount(() => {
		const updateDisplayedPlaylists = () => {
			const customPlaylists = Object.values(get(playlists));
			displayedPlaylists = [
				get(queue),
				get(favorites),
				get(localFiles),
				getPlayedPlaylist(),
				...customPlaylists,
			];
		};

		const playlistUnsubscribers = [
			playlists.subscribe(updateDisplayedPlaylists),
			queue.subscribe(updateDisplayedPlaylists),
			favorites.subscribe(updateDisplayedPlaylists),
			localFiles.subscribe(updateDisplayedPlaylists),
			playedEpisodes.subscribe(() => {
				updateDisplayedPlaylists();
				if (isShowingPlayedEpisodes) {
					updateDisplayedPlayedEpisodes();
				}
			}),
		];

		const unsubscribeSavedFeeds = savedFeeds.subscribe((storeValue) => {
			const updatedFeeds = Object.values(storeValue);
			const previousFeedTitles = new Set(feeds.map((feed) => feed.title));

			feeds = updatedFeeds;

			const newFeeds = updatedFeeds.filter(
				(feed) => !previousFeedTitles.has(feed.title),
			);

			if (newFeeds.length > 0) {
				void fetchEpisodesInAllFeeds(newFeeds);
			}
		});

		let currentViewState = get(viewState);
		const unsubscribeViewState = viewState.subscribe((vs) => {
			currentViewState = vs;
		});

		const unsubscribeLatestEpisodes = latestEpisodesStore.subscribe(
			(episodes) => {
				latestEpisodes = episodes;

				if (
					currentViewState === ViewState.EpisodeList &&
					!selectedFeed &&
					!selectedPlaylist &&
					!isShowingPlayedEpisodes
				) {
					displayedEpisodes = currentSearchQuery
						? searchEpisodes(currentSearchQuery, episodes)
						: episodes;
				}
			},
		);

		return () => {
			unsubscribeLatestEpisodes();
			unsubscribeViewState();
			unsubscribeSavedFeeds();
			playlistUnsubscribers.forEach((unsubscribe) => unsubscribe());
		};
	});

	async function fetchEpisodes(
		feed: PodcastFeed,
		useCache: boolean = true,
	): Promise<Episode[]> {

		const pluginInstance = get(plugin);
		const feedCacheSettings = pluginInstance?.settings?.feedCache;
		const cacheEnabled = feedCacheSettings?.enabled !== false;
		const cacheTtlMs =
			Math.max(1, feedCacheSettings?.ttlHours ?? 6) * 60 * 60 * 1000;

		const currentCache = get(episodeCache);
		const cachedEpisodesInFeed = currentCache[feed.title];

		if (
			useCache &&
			cachedEpisodesInFeed &&
			cachedEpisodesInFeed.length > 0
		) {
			return cachedEpisodesInFeed;
		}

		if (useCache && cacheEnabled) {
			const persistedEpisodes = getCachedEpisodes(feed, cacheTtlMs);
			if (persistedEpisodes?.length) {
				episodeCache.update((cache) => ({
					...cache,
					[feed.title]: persistedEpisodes,
				}));
				return persistedEpisodes;
			}
		}

		try {
			const episodes = await new FeedParser(feed).getEpisodes(feed.url);

			episodeCache.update((cache) => ({
				...cache,
				[feed.title]: episodes,
			}));
			if (cacheEnabled) {
				setCachedEpisodes(feed, episodes);
			}

			return episodes;
		} catch (error) {
			console.error(
				`Failed to fetch episodes for ${feed.title}:`,
				error,
			);
			const downloaded = get(downloadedEpisodes);
			return downloaded[feed.title] || [];
		}
	}

	function getPlayedPlaylist(): Playlist {
		return {
			...PLAYED_SETTINGS,
			episodes: getFinishedPlayedEpisodeRecords(get(playedEpisodes)).map(
				({ episode }) => createPlayedEpisodePlaceholder(episode),
			),
			isVirtual: true,
		};
	}

	function getEpisodeSources(): Episode[][] {
		const cachedEpisodes = Object.values(get(episodeCache));
		const downloaded = Object.values(get(downloadedEpisodes));
		const userPlaylists = Object.values(get(playlists)).map(
			(playlist) => playlist.episodes,
		);

		return [
			...cachedEpisodes,
			...downloaded,
			get(queue).episodes,
			get(favorites).episodes,
			get(localFiles).episodes,
			...userPlaylists,
		];
	}

	function filterPlayedEntries(
		entries: PlayedEpisodeListEntry[],
		query: string,
	): PlayedEpisodeListEntry[] {
		if (!query) return entries;

		const entriesByEpisode = new Map(
			entries.map((entry) => [entry.episode, entry]),
		);

		return searchEpisodes(
			query,
			entries.map((entry) => entry.episode),
		)
			.map((episode) => entriesByEpisode.get(episode))
			.filter((entry): entry is PlayedEpisodeListEntry => Boolean(entry));
	}

	function updateDisplayedPlayedEpisodes() {
		const entries = buildPlayedEpisodeListEntries(
			get(playedEpisodes),
			getEpisodeSources(),
		);
		displayedEpisodeEntries = filterPlayedEntries(
			entries,
			currentSearchQuery,
		);
		displayedEpisodes = displayedEpisodeEntries.map((entry) => entry.episode);
	}

	function isPlayedPlaylistSelected() {
		return (
			isShowingPlayedEpisodes &&
			selectedPlaylist?.isVirtual &&
			selectedPlaylist.name === PLAYED_SETTINGS.name
		);
	}

	function updateDisplayedPlayedEpisodesIfSelected() {
		if (!isPlayedPlaylistSelected()) return;

		updateDisplayedPlayedEpisodes();
	}

	function showLatestEpisodes() {
		selectedFeed = null;
		selectedPlaylist = null;
		isShowingPlayedEpisodes = false;
		displayedEpisodeEntries = null;
		displayedEpisodes = currentSearchQuery
			? searchEpisodes(currentSearchQuery, latestEpisodes)
			: latestEpisodes;
		viewState.set(ViewState.EpisodeList);
	}

	function getPlayedEpisodeKey(entry: EpisodeListEntry): string | undefined {
		if (!("playedEpisodeKey" in entry)) return undefined;

		return typeof entry.playedEpisodeKey === "string"
			? entry.playedEpisodeKey
			: undefined;
	}

	function setFeedLoading(feedTitle: string, isLoading: boolean) {
		// Don't update state if component is unmounted
		if (!isMounted) return;

		const updatedLoadingFeeds = new Set(loadingFeeds);

		if (isLoading) {
			updatedLoadingFeeds.add(feedTitle);
		} else {
			updatedLoadingFeeds.delete(feedTitle);
		}

		loadingFeeds = updatedLoadingFeeds;
	}

	function fetchEpisodesInAllFeeds(
		feedsToSearch: PodcastFeed[],
		useCache: boolean = true,
	): Promise<void> {
		if (!feedsToSearch.length) return Promise.resolve();

		return Promise.all(
			feedsToSearch.map(async (feed) => {
				setFeedLoading(feed.title, true);

				try {
					await fetchEpisodes(feed, useCache);
				} finally {
					setFeedLoading(feed.title, false);
				}
			})
		).then(() => undefined);
	}

	async function handleClickPodcast(
		event: CustomEvent<{ feed: PodcastFeed }>
	) {
		const { feed } = event.detail;

		selectedFeed = feed;
		selectedPlaylist = null;
		isShowingPlayedEpisodes = false;
		displayedEpisodeEntries = null;
		displayedEpisodes = [];
		viewState.set(ViewState.EpisodeList);
		setFeedLoading(feed.title, true);

		try {
			const episodes = await fetchEpisodes(feed, false);
			displayedEpisodes = currentSearchQuery
				? searchEpisodes(currentSearchQuery, episodes)
				: episodes;
		} finally {
			setFeedLoading(feed.title, false);
		}
	}

	function handleClickEpisode(
		event: CustomEvent<{ episode: Episode; entry: EpisodeListEntry }>,
	) {
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

	async function handleClickRefresh() {
		if (isShowingPlayedEpisodes) {
			await fetchEpisodesInAllFeeds(feeds, false);
			updateDisplayedPlayedEpisodesIfSelected();
			return;
		}

		if (!selectedFeed) return;

		setFeedLoading(selectedFeed.title, true);

		try {
			const episodes = await fetchEpisodes(selectedFeed, false);
			displayedEpisodeEntries = null;
			displayedEpisodes = currentSearchQuery
				? searchEpisodes(currentSearchQuery, episodes)
				: episodes;
		} finally {
			setFeedLoading(selectedFeed.title, false);
		}
	}

	const handleSearch = debounce((event: CustomEvent<{ query: string }>) => {
		const { query } = event.detail;
		currentSearchQuery = query;

		if (isShowingPlayedEpisodes) {
			updateDisplayedPlayedEpisodes();
			return;
		}

		if (selectedFeed) {
			const cache = get(episodeCache);
			const episodesInFeed = cache[selectedFeed.title] ?? [];
			displayedEpisodeEntries = null;
			displayedEpisodes = searchEpisodes(query, episodesInFeed);
			return;
		}

		if (selectedPlaylist) {
			displayedEpisodeEntries = null;
			displayedEpisodes = searchEpisodes(query, selectedPlaylist.episodes);
			return;
		}

		displayedEpisodeEntries = null;
		displayedEpisodes = searchEpisodes(query, latestEpisodes);
	}, 250);

	function handleClickPlaylist(
		event: CustomEvent<{ event: MouseEvent; playlist: Playlist }>
	) {
		const { playlist } = event.detail;

		if (playlist.isVirtual && playlist.name === PLAYED_SETTINGS.name) {
			selectedFeed = null;
			selectedPlaylist = playlist;
			isShowingPlayedEpisodes = true;
			displayedEpisodes = [];
			displayedEpisodeEntries = [];
			viewState.set(ViewState.EpisodeList);

			void fetchEpisodesInAllFeeds(feeds, false).then(() => {
				updateDisplayedPlayedEpisodesIfSelected();
			});
			return;
		}

		if (playlist.name === $queue.name && $queue.episodes.length > 0) {
			selectedFeed = null;
			selectedPlaylist = null;
			isShowingPlayedEpisodes = false;
			displayedEpisodeEntries = null;
			// Only need to set the current episode if there isn't any.
			// The current episode _is_ the front of the queue.
			if (!$currentEpisode) {
				currentEpisode.set($queue.episodes[0]);
			}

			viewState.set(ViewState.Player);
		} else {
			selectedFeed = null;
			selectedPlaylist = playlist;
			isShowingPlayedEpisodes = false;
			displayedEpisodeEntries = null;
			displayedEpisodes = playlist.episodes;

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
		{#if loadingFeedNames.length > 0}
			<div class="feed-loading-banner">
				<div class="feed-loading-spinner">
					<Icon icon="loader-2" size={18} clickable={false} />
				</div>
				<div class="feed-loading-text">
					<span>
						Updating {loadingFeedNames.length} feed{loadingFeedNames.length === 1 ? "" : "s"}
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
			showThumbnails={!selectedPlaylist || isShowingPlayedEpisodes}
			showPlayedToggle={!isShowingPlayedEpisodes}
			alwaysShowPlayedEpisodes={isShowingPlayedEpisodes}
			isLoading={selectedFeed ? loadingFeeds.has(selectedFeed.title) : isFetchingEpisodes}
			on:clickEpisode={handleClickEpisode}
			on:contextMenuEpisode={handleContextMenuEpisode}
			on:clickRefresh={handleClickRefresh}
			on:search={handleSearch}
		>
			<svelte:fragment slot="header">
				{#if selectedFeed}
					<button
						type="button"
						class="go-back"
						on:click={showLatestEpisodes}
					>
						<Icon
							icon={"arrow-left"}
							size={20}
							clickable={false}
						/> Latest Episodes
					</button>
					<EpisodeListHeader
						text={selectedFeed.title}
						artworkUrl={selectedFeed.artworkUrl}
					/>
				{:else if selectedPlaylist}
					<button
						type="button"
						class="go-back"
						on:click={showLatestEpisodes}
					>
						<Icon
							icon={"arrow-left"}
							size={20}
							clickable={false}
						/> Latest Episodes
					</button>
					<div class="playlist-header-icon">
						<Icon
							icon={selectedPlaylist.icon}
							size={40}
							clickable={false}
						/>
					</div>
					<EpisodeListHeader text={selectedPlaylist.name} />
				{:else}
					<EpisodeListHeader text="Latest Episodes" />
				{/if}
			</svelte:fragment>
		</EpisodeList>
	{:else if $viewState === ViewState.PodcastGrid}
		<PodcastGrid
			{feeds}
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
		transition: color 120ms ease, background-color 120ms ease;
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
