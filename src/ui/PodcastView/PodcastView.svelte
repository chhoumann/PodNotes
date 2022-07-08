<script lang="ts">
	import { PodcastFeed } from "src/types/PodcastFeed";
	import FeedGrid from "./PodcastGrid.svelte";
	import { currentEpisode, savedFeeds } from "src/store";
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

	function handleclickPodcast(event: CustomEvent<{ feed: PodcastFeed }>) {
		const { feed } = event.detail;
		selectedFeed = feed;

		new FeedParser(feed).parse(feed.url).then((episodes) => {
			episodeList = episodes;
		});

		viewState = ViewState.EpisodeList;
	}

	function handleClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		const { episode } = event.detail;
		currentEpisode.set(episode);

		viewState = ViewState.Player;
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
		/>
	{:else if viewState === ViewState.PodcastGrid}
		<FeedGrid feeds={feeds} on:clickPodcast={handleclickPodcast} />
	{/if}
</div>

<style>
	.podcast-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
</style>
