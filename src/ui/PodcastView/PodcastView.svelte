<script lang="ts">
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import PodcastGrid from "./PodcastGrid.svelte";
import {
	currentEpisode,
	savedFeeds,
	episodeCache,
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
	let isFetchingEpisodes: boolean = false;
	let pendingEpisodeFetches: number = 0;

	function startEpisodeFetch() {
		pendingEpisodeFetches += 1;
		isFetchingEpisodes = true;
	}

	function finishEpisodeFetch() {
		pendingEpisodeFetches = Math.max(0, pendingEpisodeFetches - 1);
		isFetchingEpisodes = pendingEpisodeFetches > 0;
	}

onMount(() => {
	const unsubscribePlaylists = playlists.subscribe((pl) => {
		displayedPlaylists = [$queue, $favorites, $localFiles, ...Object.values(pl)];
	});

	const unsubscribeSavedFeeds = savedFeeds.subscribe((storeValue) => {
		feeds = Object.values(storeValue);
	});

	const unsubscribeEpisodeCache = episodeCache.subscribe((cache) => {
		latestEpisodes = Object.entries(cache)
			.map(([_, episodes]) => episodes.slice(0, 10))
			.flat()
			.sort((a, b) => {
				if (a.episodeDate && b.episodeDate)
					return Number(b.episodeDate) - Number(a.episodeDate);

				return 0;
			});
	});

	(async () => {
		await fetchEpisodesInAllFeeds(feeds);

		if (!selectedFeed) {
			displayedEpisodes = latestEpisodes;
		}
	})();

	return () => {
		unsubscribeEpisodeCache();
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

	async function fetchEpisodesInAllFeeds(
		feedsToSearch: PodcastFeed[]
	): Promise<Episode[]> {
		if (!feedsToSearch.length) {
			return [];
		}

		startEpisodeFetch();

		try {
			const episodes = await Promise.allSettled(
				feedsToSearch.map(async (feed) => {
					const feedEpisodes = await fetchEpisodes(feed);

					if (!selectedFeed && !selectedPlaylist) {
						displayedEpisodes = latestEpisodes;
					}

					return feedEpisodes;
				}),
			);

			return episodes
				.map((result) => (result.status === "fulfilled" ? result.value : []))
				.flat();
		} finally {
			finishEpisodeFetch();
		}
	}

	async function handleClickPodcast(
		event: CustomEvent<{ feed: PodcastFeed }>
	) {
		const { feed } = event.detail;

		selectedFeed = feed;
		displayedEpisodes = [];
		startEpisodeFetch();
		viewState.set(ViewState.EpisodeList);

		try {
			displayedEpisodes = await fetchEpisodes(feed);
		} finally {
			finishEpisodeFetch();
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

		startEpisodeFetch();

		try {
			displayedEpisodes = await fetchEpisodes(selectedFeed, false);
		} finally {
			finishEpisodeFetch();
		}
	}

	const handleSearch = debounce((event: CustomEvent<{ query: string }>) => {
		const { query } = event.detail;

		if (selectedFeed) {
			const episodesInFeed = $episodeCache[selectedFeed.title];
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
		<EpisodeList
			episodes={displayedEpisodes}
			showThumbnails={!selectedFeed || !selectedPlaylist}
			isLoading={isFetchingEpisodes}
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
							displayedEpisodes = latestEpisodes;
							viewState.set(ViewState.EpisodeList);
						}}
					>
						<Icon
							icon={"arrow-left"}
							style={{
								display: "flex",
								"align-items": "center",
							}}
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
							displayedEpisodes = latestEpisodes;
							viewState.set(ViewState.EpisodeList);
						}}
					>
						<Icon
							icon={"arrow-left"}
							style={{
								display: "flex",
								"align-items": "center",
							}}
							size={20}
							clickable={false}
						/> Latest Episodes
					</button>
					<div
						style="display: flex; align-items: center; justify-content: center;"
					>
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
</style>
