<script lang="ts">
	import { PodcastFeed } from "src/types/PodcastFeed";
	import FeedGrid from "./PodcastGrid.svelte";
	import { currentEpisode, savedFeeds, episodeCache } from "src/store";
	import EpisodePlayer from "./EpisodePlayer.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import { Episode } from "src/types/Episode";
	import FeedParser from "src/parser/feedParser";
	import TopBar from "./TopBar.svelte";
	import { ViewState } from "src/types/ViewState";
	import { onDestroy } from "svelte";

	let feeds: PodcastFeed[] = [];
	let selectedFeed: PodcastFeed | null = null;
	let episodeList: Episode[] = [];

	let viewState: ViewState;

	const unsubscribe = savedFeeds.subscribe(storeValue => {
		feeds = Object.values(storeValue);
	});

	async function fetchEpisodes(feed: PodcastFeed): Promise<Episode[]> {
		return await (new FeedParser(feed).parse(feed.url));
	}

	async function handleClickPodcast(event: CustomEvent<{ feed: PodcastFeed }>) {
		episodeList = [];

		const { feed } = event.detail;
		selectedFeed = feed;

		const cachedEpisodesInFeed = $episodeCache[feed.title];

		if (cachedEpisodesInFeed && cachedEpisodesInFeed.length > 0) {
			episodeList = cachedEpisodesInFeed;
		} else {
			const episodes = await fetchEpisodes(feed);
			
			episodeList = episodes;
			episodeCache.update(cache => ({ ...cache, [feed.title]: episodes }));
		}

		viewState = ViewState.EpisodeList;
	}

	function handleClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		const { episode } = event.detail;
		currentEpisode.set(episode);

		viewState = ViewState.Player;
	}

	async function handleClickRefresh() {
		if (!selectedFeed) return;
		const { title } = selectedFeed;
		const episodes = await fetchEpisodes(selectedFeed)

		episodeList = episodes;
		episodeCache.update(cache => ({ ...cache, [title]: episodes }));
	}

	onDestroy(unsubscribe);
</script>

<div class="podcast-view">
	<TopBar
		bind:viewState
		canShowEpisodeList={!!selectedFeed}
		canShowPlayer={!!$currentEpisode}
	/>

	{#if viewState === ViewState.Player}
		<EpisodePlayer />
	{:else if viewState === ViewState.EpisodeList}
		<EpisodeList
			feed={selectedFeed}
			episodes={episodeList}
			on:clickEpisode={handleClickEpisode}
			on:clickRefresh={handleClickRefresh}
		/>
	{:else if viewState === ViewState.PodcastGrid}
		<FeedGrid 
			feeds={feeds} 
			on:clickPodcast={handleClickPodcast} 
		/>
	{/if}
</div>

<style>
	.podcast-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
</style>
