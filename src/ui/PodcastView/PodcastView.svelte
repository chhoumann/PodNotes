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
	const LATEST_EPISODES_PER_FEED = 10;
	const LATEST_EPISODES_LIMIT = 100; // keep the merged "Latest" list bounded for quick updates
	const latestEpisodesByFeed: Record<string, Episode[]> = {};
	let feedCacheSnapshot: Record<string, Episode[]> = {};

	const episodeIdentifier = (episode: Episode): string =>
		`${episode.podcastName}::${episode.title}`;

	const episodeTimestamp = (episode: Episode): number =>
		episode.episodeDate ? Number(episode.episodeDate) : 0;

	function insertEpisodeSorted(
		episodes: Episode[],
		episodeToInsert: Episode,
		limit: number,
	): Episode[] {
		const nextEpisodes = [...episodes];
		const value = episodeTimestamp(episodeToInsert);
		let low = 0;
		let high = nextEpisodes.length;

		while (low < high) {
			const mid = (low + high) >> 1;
			const midValue = episodeTimestamp(nextEpisodes[mid]);

			if (value > midValue) {
				high = mid;
			} else {
				low = mid + 1;
			}
		}

		nextEpisodes.splice(low, 0, episodeToInsert);

		if (nextEpisodes.length > limit) {
			nextEpisodes.length = limit;
		}

		return nextEpisodes;
	}

	function removeFeedEntries(
		currentLatest: Episode[],
		feedEpisodes: Episode[] = [],
	): Episode[] {
		if (!feedEpisodes.length) {
			return currentLatest;
		}

		const feedKeys = new Set(feedEpisodes.map(episodeIdentifier));

		return currentLatest.filter(
			(episode) => !feedKeys.has(episodeIdentifier(episode)),
		);
	}

	function updateLatestEpisodesForFeed(
		currentLatest: Episode[],
		previousFeedEpisodes: Episode[],
		nextFeedEpisodes: Episode[],
		limit: number,
	): Episode[] {
		let nextLatest = removeFeedEntries(currentLatest, previousFeedEpisodes);

		for (const episode of nextFeedEpisodes) {
			nextLatest = insertEpisodeSorted(nextLatest, episode, limit);
		}

		return nextLatest;
	}

onMount(() => {
	const unsubscribePlaylists = playlists.subscribe((pl) => {
		displayedPlaylists = [$queue, $favorites, $localFiles, ...Object.values(pl)];
	});

	const unsubscribeSavedFeeds = savedFeeds.subscribe((storeValue) => {
		feeds = Object.values(storeValue);
	});

	const unsubscribeEpisodeCache = episodeCache.subscribe((cache) => {
		const changedFeeds = new Set<string>();

		for (const [feedTitle, episodes] of Object.entries(cache)) {
			if (feedCacheSnapshot[feedTitle] !== episodes) {
				changedFeeds.add(feedTitle);
			}
		}

		for (const feedTitle of Object.keys(feedCacheSnapshot)) {
			if (!(feedTitle in cache)) {
				changedFeeds.add(feedTitle);
			}
		}

		if (!changedFeeds.size) {
			return;
		}

		const queueLimit = Math.max(
			LATEST_EPISODES_PER_FEED * Object.keys(cache).length,
			LATEST_EPISODES_LIMIT,
		);
		let updatedLatest = latestEpisodes;

		for (const feedTitle of changedFeeds) {
			if (!(feedTitle in cache)) {
				updatedLatest = removeFeedEntries(
					updatedLatest,
					latestEpisodesByFeed[feedTitle],
				);
				delete latestEpisodesByFeed[feedTitle];
				continue;
			}

			const previousFeedLatest = latestEpisodesByFeed[feedTitle] || [];
			const nextFeedLatest = cache[feedTitle].slice(
				0,
				LATEST_EPISODES_PER_FEED,
			);

			updatedLatest = updateLatestEpisodesForFeed(
				updatedLatest,
				previousFeedLatest,
				nextFeedLatest,
				queueLimit,
			);

			latestEpisodesByFeed[feedTitle] = nextFeedLatest;
		}

		latestEpisodes = updatedLatest;
		feedCacheSnapshot = { ...cache };
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

	function fetchEpisodesInAllFeeds(
		feedsToSearch: PodcastFeed[]
	): Promise<Episode[]> {
		return Promise.all(
			feedsToSearch.map((feed) => fetchEpisodes(feed))
		).then((episodes) => {
			return episodes.flat();
		});
	}

	async function handleClickPodcast(
		event: CustomEvent<{ feed: PodcastFeed }>
	) {
		const { feed } = event.detail;
		displayedEpisodes = [];

		selectedFeed = feed;
		displayedEpisodes = await fetchEpisodes(feed);
		viewState.set(ViewState.EpisodeList);
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

		displayedEpisodes = await fetchEpisodes(selectedFeed, false);
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
