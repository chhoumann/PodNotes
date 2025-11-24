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
	} from "src/store";
	import EpisodePlayer from "./EpisodePlayer.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import type { Episode } from "src/types/Episode";
	import FeedParser from "src/parser/feedParser";
	import TopBar from "./TopBar.svelte";
	import { ViewState } from "src/types/ViewState";
	import { onMount } from "svelte";
	import EpisodeListHeader from "./EpisodeListHeader.svelte";
	import Icon from "../obsidian/Icon.svelte";
	import { debounce } from "obsidian";
	import searchEpisodes from "src/utility/searchEpisodes";
	import type { Playlist } from "src/types/Playlist";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import {
		getCachedEpisodes,
		setCachedEpisodes,
	} from "src/services/FeedCacheService";
	import { get } from "svelte/store";

	let feeds: PodcastFeed[] = [];
	let selectedFeed: PodcastFeed | null = null;
	let selectedPlaylist: Playlist | null = null;
	let displayedEpisodes: Episode[] = [];
	let displayedPlaylists: Playlist[] = [];
	let latestEpisodes: Episode[] = [];
	let loadingFeeds: Set<string> = new Set();
	let currentSearchQuery: string = "";
	let loadingFeedNames: string[] = [];
	let loadingFeedSummary: string = "";

	$: loadingFeedNames = Array.from(loadingFeeds);
	$: loadingFeedSummary =
		loadingFeedNames.length > 3
			? `${loadingFeedNames.slice(0, 3).join(", ")} +${loadingFeedNames.length - 3} more`
			: loadingFeedNames.join(", ");

	onMount(() => {
		const unsubscribePlaylists = playlists.subscribe((pl) => {
			displayedPlaylists = [$queue, $favorites, $localFiles, ...Object.values(pl)];
		});

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

		const unsubscribeLatestEpisodes = latestEpisodesStore.subscribe(
			(episodes) => {
				latestEpisodes = episodes;

				if (!selectedFeed && !selectedPlaylist) {
					displayedEpisodes = currentSearchQuery
						? searchEpisodes(currentSearchQuery, episodes)
						: episodes;
				}
			},
		);

		return () => {
			unsubscribeLatestEpisodes();
			unsubscribeSavedFeeds();
			unsubscribePlaylists();
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

		const cachedEpisodesInFeed = $episodeCache[feed.title];

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
			return $downloadedEpisodes[feed.title] || [];
		}
	}

	function setFeedLoading(feedTitle: string, isLoading: boolean) {
		const updatedLoadingFeeds = new Set(loadingFeeds);

		if (isLoading) {
			updatedLoadingFeeds.add(feedTitle);
		} else {
			updatedLoadingFeeds.delete(feedTitle);
		}

		loadingFeeds = updatedLoadingFeeds;
	}

	function fetchEpisodesInAllFeeds(
		feedsToSearch: PodcastFeed[]
	): Promise<void> {
		if (!feedsToSearch.length) return Promise.resolve();

		return Promise.all(
			feedsToSearch.map(async (feed) => {
				setFeedLoading(feed.title, true);

				try {
					await fetchEpisodes(feed);
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
		displayedEpisodes = [];

		selectedFeed = feed;
		viewState.set(ViewState.EpisodeList);
		setFeedLoading(feed.title, true);

		try {
			const episodes = await fetchEpisodes(feed);
			displayedEpisodes = currentSearchQuery
				? searchEpisodes(currentSearchQuery, episodes)
				: episodes;
		} finally {
			setFeedLoading(feed.title, false);
		}
	}

	function handleClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		const { episode } = event.detail;
		currentEpisode.set(episode);

		viewState.set(ViewState.Player);
	}

	function handleContextMenuEpisode({
		detail: { event, episode },
	}: CustomEvent<{ episode: Episode; event: MouseEvent }>) {
		spawnEpisodeContextMenu(episode, event);
	}

	async function handleClickRefresh() {
		if (!selectedFeed) return;

		setFeedLoading(selectedFeed.title, true);

		try {
			const episodes = await fetchEpisodes(selectedFeed, false);
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

		if (selectedFeed) {
			const episodesInFeed = $episodeCache[selectedFeed.title] ?? [];
			displayedEpisodes = searchEpisodes(query, episodesInFeed);
			return;
		}

		displayedEpisodes = searchEpisodes(query, latestEpisodes);
	}, 250);

	function handleClickPlaylist(
		event: CustomEvent<{ event: MouseEvent; playlist: Playlist }>
	) {
		const { event: clickEvent, playlist } = event.detail;

		if (playlist.name === $queue.name && $queue.episodes.length > 0) {
			// Only need to set the current episode if there isn't any.
			// The current episode _is_ the front of the queue.
			if (!$currentEpisode) {
				currentEpisode.set($queue.episodes[0]);
			}

			viewState.set(ViewState.Player);
		} else {
			selectedPlaylist = playlist;
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
			showThumbnails={!selectedFeed || !selectedPlaylist}
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
						on:click={() => {
							selectedFeed = null;
							displayedEpisodes = currentSearchQuery
								? searchEpisodes(currentSearchQuery, latestEpisodes)
								: latestEpisodes;
							viewState.set(ViewState.EpisodeList);
						}}
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
						on:click={() => {
							selectedPlaylist = null;
							displayedEpisodes = currentSearchQuery
								? searchEpisodes(currentSearchQuery, latestEpisodes)
								: latestEpisodes;
							viewState.set(ViewState.EpisodeList);
						}}
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
	}

	.feed-loading-banner {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		box-sizing: border-box;
	}

	.feed-loading-spinner {
		display: inline-flex;
		animation: spin 1s linear infinite;
	}

	.feed-loading-text {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		font-size: 0.9rem;
	}

	.feed-loading-names {
		opacity: 0.7;
		font-size: 0.85rem;
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
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		gap: 0.5rem;
		margin-right: auto;
		opacity: 0.75;
		cursor: pointer;
		background: none;
		border: none;
	}

	.go-back:hover {
		opacity: 1;
	}

	.playlist-header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
