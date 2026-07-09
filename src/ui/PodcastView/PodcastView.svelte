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
	import { getCachedEpisodes, setCachedEpisodes } from "src/services/FeedCacheService";
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
	// Exclude the selected feed from the banner: its loading state is already
	// shown by the inline EpisodeList spinner, so the banner would duplicate it.
	$: bannerFeedNames = loadingFeedNames.filter((name) => name !== selectedFeed?.title);
	$: loadingFeedSummary =
		bannerFeedNames.length > 3
			? `${bannerFeedNames.slice(0, 3).join(", ")} +${bannerFeedNames.length - 3} more`
			: bannerFeedNames.join(", ");
	$: isFetchingEpisodes = loadingFeedNames.length > 0;

	onMount(() => {
		const updateDisplayedPlaylists = () => {
			const customPlaylists = Object.values(get(playlists));
			const queueValue = get(queue);
			// Hide the Queue tile only when queue automation is off AND the queue is
			// empty (issue #108), so turning the queue off doesn't leave a permanent
			// empty "Queue" tile. The default-on state and a non-empty manual queue
			// both keep it visible.
			const showQueue =
				get(plugin)?.settings?.autoQueue !== false || queueValue.episodes.length > 0;
			displayedPlaylists = [
				...(showQueue ? [queueValue] : []),
				get(favorites),
				get(localFiles),
				getPlayedPlaylist(),
				...customPlaylists,
			];
		};

		// Refresh both the grid tiles AND an open playlist's episode list so a
		// context-menu add/remove updates the currently-viewed list immediately
		// (PL-04).
		const refreshPlaylists = () => {
			updateDisplayedPlaylists();
			updateDisplayedPlaylistEpisodesIfSelected();
		};

		const playlistUnsubscribers = [
			playlists.subscribe(refreshPlaylists),
			queue.subscribe(updateDisplayedPlaylists),
			favorites.subscribe(refreshPlaylists),
			localFiles.subscribe(refreshPlaylists),
			// Recompute when the plugin store re-emits so toggling the autoQueue
			// setting hides/shows the empty Queue tile immediately (issue #108).
			plugin.subscribe(updateDisplayedPlaylists),
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

			const newFeeds = updatedFeeds.filter((feed) => !previousFeedTitles.has(feed.title));

			if (newFeeds.length > 0) {
				void fetchEpisodesInAllFeeds(newFeeds);
			}
		});

		let currentViewState = get(viewState);
		const unsubscribeViewState = viewState.subscribe((vs) => {
			currentViewState = vs;
		});

		const unsubscribeLatestEpisodes = latestEpisodesStore.subscribe((episodes) => {
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
		});

		return () => {
			unsubscribeLatestEpisodes();
			unsubscribeViewState();
			unsubscribeSavedFeeds();
			playlistUnsubscribers.forEach((unsubscribe) => unsubscribe());
		};
	});

	type EpisodeFetchStrategy = "cached" | "full" | "network";

	function getFeedCacheTtlMs(): number {
		const feedCacheSettings = get(plugin)?.settings?.feedCache;
		return Math.max(1, feedCacheSettings?.ttlHours ?? 6) * 60 * 60 * 1000;
	}

	function isFeedCacheEnabled(): boolean {
		return get(plugin)?.settings?.feedCache?.enabled !== false;
	}

	function hasFullInMemoryFeed(
		inMemoryEpisodes: Episode[] | undefined,
		persistedEpisodes: Episode[] | null,
	): boolean {
		if (!inMemoryEpisodes?.length) {
			return false;
		}

		if (!persistedEpisodes?.length) {
			return true;
		}

		return inMemoryEpisodes.length > persistedEpisodes.length;
	}

	async function fetchEpisodes(
		feed: PodcastFeed,
		useCache: boolean = true,
		notifyOnError: boolean = false,
	): Promise<Episode[]> {
		const cacheEnabled = isFeedCacheEnabled();
		const cacheTtlMs = getFeedCacheTtlMs();

		const currentCache = get(episodeCache);
		const cachedEpisodesInFeed = currentCache[feed.title];

		if (useCache && cachedEpisodesInFeed && cachedEpisodesInFeed.length > 0) {
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
			console.error(`Failed to fetch episodes for ${feed.title}:`, error);
			const downloaded = get(downloadedEpisodes);
			if (downloaded[feed.title]?.length) {
				return downloaded[feed.title];
			}

			if (!useCache) {
				if (cachedEpisodesInFeed?.length) {
					return cachedEpisodesInFeed;
				}

				if (cacheEnabled) {
					const persistedEpisodes = getCachedEpisodes(feed, cacheTtlMs);
					if (persistedEpisodes?.length) {
						episodeCache.update((cache) => ({
							...cache,
							[feed.title]: persistedEpisodes,
						}));
						return persistedEpisodes;
					}
				}
			}

			// No cache/download fallback recovered episodes. Surface a Notice
			// only for the interactive single-feed path; the bulk/background
			// path stays quiet to avoid spamming on refresh or initial load.
			if (notifyOnError) {
				new Notice(
					`Could not load episodes for ${feed.title}. Check your connection and try again.`,
				);
			}

			return [];
		}
	}

	function getFeedsWithPlayedEpisodes(): PodcastFeed[] {
		const playedPodcastNames = new Set(
			getFinishedPlayedEpisodeRecords(get(playedEpisodes)).map(
				({ episode }) => episode.podcastName,
			),
		);

		return feeds.filter((feed) => playedPodcastNames.has(feed.title));
	}

	async function fetchFullEpisodes(
		feed: PodcastFeed,
		notifyOnError: boolean = false,
	): Promise<Episode[]> {
		const cacheEnabled = isFeedCacheEnabled();
		const persistedEpisodes = cacheEnabled
			? getCachedEpisodes(feed, getFeedCacheTtlMs())
			: null;
		const inMemoryEpisodes = get(episodeCache)[feed.title];

		if (hasFullInMemoryFeed(inMemoryEpisodes, persistedEpisodes)) {
			return inMemoryEpisodes;
		}

		return fetchEpisodes(feed, false, notifyOnError);
	}

	async function fetchEpisodesByStrategy(
		feed: PodcastFeed,
		strategy: EpisodeFetchStrategy = "cached",
		notifyOnError: boolean = false,
	): Promise<Episode[]> {
		if (strategy === "network") {
			return fetchEpisodes(feed, false, notifyOnError);
		}

		if (strategy === "full") {
			return fetchFullEpisodes(feed, notifyOnError);
		}

		return fetchEpisodes(feed, true, notifyOnError);
	}

	function getPlayedPlaylist(): Playlist {
		return {
			...PLAYED_SETTINGS,
			episodes: getFinishedPlayedEpisodeRecords(get(playedEpisodes)).map(({ episode }) =>
				createPlayedEpisodePlaceholder(episode),
			),
			isVirtual: true,
		};
	}

	function getEpisodeSources(): Episode[][] {
		const cachedEpisodes = Object.values(get(episodeCache));
		const downloaded = Object.values(get(downloadedEpisodes));
		const userPlaylists = Object.values(get(playlists)).map((playlist) => playlist.episodes);

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

		const entriesByEpisode = new Map(entries.map((entry) => [entry.episode, entry]));

		return searchEpisodes(
			query,
			entries.map((entry) => entry.episode),
		)
			.map((episode) => entriesByEpisode.get(episode))
			.filter((entry): entry is PlayedEpisodeListEntry => Boolean(entry));
	}

	function updateDisplayedPlayedEpisodes() {
		const entries = buildPlayedEpisodeListEntries(get(playedEpisodes), getEpisodeSources());
		displayedEpisodeEntries = filterPlayedEntries(entries, currentSearchQuery);
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

	// Keep an OPEN playlist's episode list in sync when its backing store changes
	// (e.g. a context-menu add/remove). Without this the list view only reflected
	// the snapshot taken at click time and went stale until the user navigated
	// away and back (PL-04). The virtual Played list and the Queue (which routes
	// to the player) are handled elsewhere, so they are skipped here.
	function updateDisplayedPlaylistEpisodesIfSelected() {
		if (!selectedPlaylist || selectedPlaylist.isVirtual) return;

		const name = selectedPlaylist.name;
		if (name === get(queue).name) return;

		let live: Playlist | undefined;
		if (name === get(favorites).name) live = get(favorites);
		else if (name === get(localFiles).name) live = get(localFiles);
		else {
			live = get(playlists)[name];
			if (!live) {
				// A custom playlist deleted while open: fall back to Latest Episodes.
				showLatestEpisodes();
				return;
			}
		}

		if (!live) return;

		selectedPlaylist = live;
		displayedEpisodes = currentSearchQuery
			? searchEpisodes(currentSearchQuery, live.episodes)
			: live.episodes;
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

		return typeof entry.playedEpisodeKey === "string" ? entry.playedEpisodeKey : undefined;
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
		strategy: EpisodeFetchStrategy = "cached",
	): Promise<void> {
		if (!feedsToSearch.length) return Promise.resolve();

		return Promise.all(
			feedsToSearch.map(async (feed) => {
				setFeedLoading(feed.title, true);

				try {
					await fetchEpisodesByStrategy(feed, strategy);
				} finally {
					setFeedLoading(feed.title, false);
				}
			}),
		).then(() => undefined);
	}

	async function handleClickPodcast(event: CustomEvent<{ feed: PodcastFeed }>) {
		const { feed } = event.detail;

		selectedFeed = feed;
		selectedPlaylist = null;
		isShowingPlayedEpisodes = false;
		displayedEpisodeEntries = null;
		displayedEpisodes = [];
		viewState.set(ViewState.EpisodeList);
		setFeedLoading(feed.title, true);

		try {
			const episodes = await fetchFullEpisodes(feed, true);
			displayedEpisodes = currentSearchQuery
				? searchEpisodes(currentSearchQuery, episodes)
				: episodes;
		} finally {
			setFeedLoading(feed.title, false);
		}
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

	async function handleClickRefresh() {
		if (isShowingPlayedEpisodes) {
			await fetchEpisodesInAllFeeds(getFeedsWithPlayedEpisodes(), "network");
			updateDisplayedPlayedEpisodesIfSelected();
			return;
		}

		// Latest Episodes view (no feed and no playlist selected): refresh all
		// feeds over the network so the aggregated list actually updates. The
		// latestEpisodes readable + its subscriber repopulate displayedEpisodes,
		// and setFeedLoading inside fetchEpisodesInAllFeeds drives the banner.
		if (!selectedFeed && !selectedPlaylist) {
			await fetchEpisodesInAllFeeds(feeds, "network");
			return;
		}

		if (!selectedFeed) return;

		setFeedLoading(selectedFeed.title, true);

		try {
			const episodes = await fetchEpisodesByStrategy(selectedFeed, "network", true);
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

	function handleClickPlaylist(event: CustomEvent<{ event: MouseEvent; playlist: Playlist }>) {
		const { playlist } = event.detail;

		if (playlist.isVirtual && playlist.name === PLAYED_SETTINGS.name) {
			selectedFeed = null;
			selectedPlaylist = playlist;
			isShowingPlayedEpisodes = true;
			displayedEpisodes = [];
			displayedEpisodeEntries = [];
			viewState.set(ViewState.EpisodeList);

			void fetchEpisodesInAllFeeds(getFeedsWithPlayedEpisodes(), "full").then(() => {
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
					<button type="button" class="go-back" on:click={showLatestEpisodes}>
						<Icon icon={"arrow-left"} size={20} clickable={false} /> Latest Episodes
					</button>
					<EpisodeListHeader
						text={selectedFeed.title}
						artworkUrl={selectedFeed.artworkUrl}
					/>
				{:else if selectedPlaylist}
					<button type="button" class="go-back" on:click={showLatestEpisodes}>
						<Icon icon={"arrow-left"} size={20} clickable={false} /> Latest Episodes
					</button>
					<div class="playlist-header-icon">
						<Icon icon={selectedPlaylist.icon} size={40} clickable={false} />
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
