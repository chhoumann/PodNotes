<script lang="ts">
	import { PodcastFeed } from "src/types/PodcastFeed";
	import FeedGrid from "./FeedGrid.svelte";
	import { currentEpisode } from "src/store";
	import EpisodePlayer from "./EpisodePlayer.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import { Episode } from "src/types/Episode";
	import FeedParser from "src/parser/feedParser";

	export let feeds: PodcastFeed[] = [];
	let selectedFeed: PodcastFeed | null = null;
	let episodeList: Episode[] = [];

	function handleClickFeed(event: CustomEvent<{feed: PodcastFeed}>) {
		const { feed } = event.detail;
		selectedFeed = feed;

		new FeedParser(feed).parse(feed.url).then(episodes => {
			episodeList = episodes;
		});
	}

</script>

<div>
	{#if $currentEpisode}
		<EpisodePlayer />
	{:else if selectedFeed}
		<EpisodeList feed={selectedFeed} episodes={episodeList} />
	{:else}
		<FeedGrid feeds={feeds} on:clickFeed={handleClickFeed} />
	{/if}
</div>
