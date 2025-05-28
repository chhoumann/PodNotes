<script lang="ts">
import { debounce } from "obsidian";
import FeedParser from "src/parser/feedParser";
import {
	currentEpisode,
	downloadedEpisodes,
	episodeCache,
	favorites,
	localFiles,
	playlists,
	queue,
	savedFeeds,
	viewState,
} from "src/store";
import type { Episode } from "src/types/Episode";
import type { Playlist } from "src/types/Playlist";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { ViewState } from "src/types/ViewState";
import searchEpisodes from "src/utility/searchEpisodes";
import { onMount } from "svelte";
import { get } from "svelte/store";
import Icon from "../obsidian/Icon.svelte";
import EpisodeList from "./EpisodeList.svelte";
import EpisodeListHeader from "./EpisodeListHeader.svelte";
import EpisodePlayer from "./EpisodePlayer.svelte";
import PodcastGrid from "./PodcastGrid.svelte";
import TopBar from "./TopBar.svelte";
import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";

let feeds: PodcastFeed[] = [];
let selectedFeed: PodcastFeed | null = null;
let selectedPlaylist: Playlist | null = null;
let displayedEpisodes: Episode[] = [];
let displayedPlaylists: Playlist[] = [];
let latestEpisodes: Episode[] = [];
let isInitialized = false;

// Performance optimization: Use reactive statements instead of manual subscriptions
$: displayedPlaylists = [
	$queue,
	$favorites,
	$localFiles,
	...Object.values($playlists),
];

$: feeds = Object.values($savedFeeds);

// Optimize episode sorting with proper memoization
let episodeCacheVersion = 0;
let sortedEpisodesCache: Episode[] = [];
let lastSortedVersion = -1;

// Update version when cache changes
$: episodeCacheVersion = Object.keys($episodeCache).length;

// Only sort when cache actually changes content
function getSortedEpisodes(): Episode[] {
	if (lastSortedVersion === episodeCacheVersion) {
		return sortedEpisodesCache;
	}
	
	lastSortedVersion = episodeCacheVersion;
	const allEpisodes = Object.entries($episodeCache)
		.flatMap(([_, episodes]) => episodes.slice(0, 10));
	
	// Only sort if we have episodes
	if (allEpisodes.length > 0) {
		sortedEpisodesCache = allEpisodes.sort((a, b) => {
			if (a.episodeDate && b.episodeDate)
				return Number(b.episodeDate) - Number(a.episodeDate);
			return 0;
		});
	} else {
		sortedEpisodesCache = [];
	}
	
	return sortedEpisodesCache;
}

// Update latestEpisodes only when needed
$: if (isInitialized && episodeCacheVersion > 0) {
	latestEpisodes = getSortedEpisodes();
}

// Separate reactive statement for updating displayed episodes
$: if (!selectedFeed && !selectedPlaylist && $viewState === ViewState.EpisodeList) {
	displayedEpisodes = latestEpisodes;
}

// Initialize on mount
onMount(async () => {
	isInitialized = true;
	if (feeds.length > 0) {
		await fetchEpisodesInAllFeeds(feeds);
	}
});

// Memoized fetch functions
const episodeFetchCache = new Map<string, Promise<Episode[]>>();

async function fetchEpisodes(
	feed: PodcastFeed,
	useCache = true,
): Promise<Episode[]> {
	const cacheKey = `${feed.title}-${useCache}`;
	
	// Return existing promise if fetch is in progress
	if (episodeFetchCache.has(cacheKey)) {
		const cachedPromise = episodeFetchCache.get(cacheKey);
		if (cachedPromise) return cachedPromise;
	}

	const cachedEpisodesInFeed = get(episodeCache)[feed.title];

	if (useCache && cachedEpisodesInFeed && cachedEpisodesInFeed.length > 0) {
		return cachedEpisodesInFeed;
	}

	// Create and cache the promise
	const fetchPromise = (async () => {
		try {
			const episodes = await new FeedParser(feed).getEpisodes(feed.url);

			episodeCache.update((cache) => ({
				...cache,
				[feed.title]: episodes,
			}));

			return episodes;
		} catch (error) {
			const downloaded = get(downloadedEpisodes);
			return downloaded[feed.title] || [];
		} finally {
			// Clean up cache after fetch
			episodeFetchCache.delete(cacheKey);
		}
	})();

	episodeFetchCache.set(cacheKey, fetchPromise);
	return fetchPromise;
}

function fetchEpisodesInAllFeeds(
	feedsToSearch: PodcastFeed[],
): Promise<Episode[]> {
	return Promise.all(feedsToSearch.map((feed) => fetchEpisodes(feed))).then(
		(episodes) => episodes.flat(),
	);
}

// Optimized event handlers - create once, not on every render
async function handleClickPodcast(event: CustomEvent<{ feed: PodcastFeed }>) {
	const { feed } = event.detail;
	displayedEpisodes = [];

	selectedFeed = feed;
	selectedPlaylist = null;
	displayedEpisodes = await fetchEpisodes(feed);
	viewState.set(ViewState.EpisodeList);
}

function handleClickEpisode(event: CustomEvent<{ episode: Episode }>) {
	const { episode } = event.detail;
	currentEpisode.set(episode);
	viewState.set(ViewState.Player);
}

function handleContextMenuEpisode(event: CustomEvent<{ episode: Episode; event: MouseEvent }>) {
	const { episode, event: mouseEvent } = event.detail;
	spawnEpisodeContextMenu(episode, mouseEvent);
}

async function handleClickRefresh() {
	if (!selectedFeed) return;
	displayedEpisodes = await fetchEpisodes(selectedFeed, false);
}

// Debounced search with proper typing
const handleSearch = debounce((event: CustomEvent<{ query: string }>) => {
	const { query } = event.detail;

	if (selectedFeed) {
		const episodesInFeed = get(episodeCache)[selectedFeed.title];
		displayedEpisodes = searchEpisodes(query, episodesInFeed);
		return;
	}

	displayedEpisodes = searchEpisodes(query, latestEpisodes);
}, 250);

function handleClickPlaylist(event: CustomEvent<{ event: MouseEvent; playlist: Playlist }>) {
	const { playlist } = event.detail;

	if (playlist.name === get(queue).name && get(queue).episodes.length > 0) {
		// Only need to set the current episode if there isn't any.
		if (!get(currentEpisode)) {
			currentEpisode.set(get(queue).episodes[0]);
		}
		viewState.set(ViewState.Player);
	} else {
		selectedPlaylist = playlist;
		selectedFeed = null;
		displayedEpisodes = playlist.episodes;
		viewState.set(ViewState.EpisodeList);
	}
}

// Optimized back button handlers
function handleBackFromFeed() {
	selectedFeed = null;
	displayedEpisodes = latestEpisodes;
	viewState.set(ViewState.EpisodeList);
}

function handleBackFromPlaylist() {
	selectedPlaylist = null;
	displayedEpisodes = latestEpisodes;
	viewState.set(ViewState.EpisodeList);
}
</script>

<div class="podcast-view">
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
						on:click={handleBackFromFeed}
					>
						<Icon
							icon={"arrow-left"}
							style={{
								display: "flex",
								"align-items": "center",
							}}
							size={20}
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
						on:click={handleBackFromPlaylist}
					>
						<Icon
							icon={"arrow-left"}
							style={{
								display: "flex",
								"align-items": "center",
							}}
							size={20}
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
		/* Enable GPU acceleration */
		will-change: contents;
	}

	.go-back {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		gap: 0.5rem;
		cursor: pointer;
		margin-right: auto;
		opacity: 0.75;
		/* Remove default button styles */
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-align: left;
		/* Optimize hover performance */
		transition: opacity 0.15s ease;
		will-change: opacity;
	}

	.go-back:hover {
		opacity: 1;
	}
</style>