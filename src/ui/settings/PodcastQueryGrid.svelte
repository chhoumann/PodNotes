<script lang="ts">
	import { debounce } from "obsidian";
	import { queryiTunesPodcasts } from "src/iTunesAPIConsumer";
	import FeedParser from "src/parser/feedParser";
	import { savedFeeds } from "src/store";
	import { PodcastFeed } from "src/types/PodcastFeed";
	import checkStringIsUrl from "src/utility/checkStringIsUrl";
	import Text from "../obsidian/Text.svelte";
	import PodcastResultCard from "./PodcastResultCard.svelte";

	let searchResults: PodcastFeed[] = [];
	let gridSizeClass: string = "grid-3";

	if (searchResults.length % 3 === 0 || searchResults.length > 3) {
		gridSizeClass = "grid-3";
	} else if (searchResults.length % 2 === 0) {
		gridSizeClass = "grid-2";
	} else if (searchResults.length % 1 === 0) {
		gridSizeClass = "grid-1";
	}

	const debouncedUpdate = debounce(
		async ({detail: { value }}: CustomEvent<{ value: string }>) => {	
			const customFeedUrl = checkStringIsUrl(value);
			
			if (customFeedUrl) {
				const feed = await (new FeedParser().getFeed(customFeedUrl.href));

				searchResults = [feed];
				return;
			} 

			searchResults = await queryiTunesPodcasts(value);
		},
		300,
		true
	);

	function addPodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
		const { podcast } = event.detail;

		savedFeeds.update((feeds) => ({ ...feeds, [podcast.title]: podcast }));
	}

	function removePodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
		const { podcast } = event.detail;

		savedFeeds.update((feeds) => {
			const newFeeds = { ...feeds };
			delete newFeeds[podcast.title];
			return newFeeds;
		});
	}
</script>

<div class="podcast-query-container">
	<Text
		placeholder="Search..."
		on:change={debouncedUpdate}
		style={{
			width: "100%",
			"margin-bottom": "1rem",
		}}
	/>

	<div
		class={`
            podcast-query-results
            ${gridSizeClass}
        `}
	>
		{#each searchResults as podcast}
			<PodcastResultCard
				{podcast}
				isSaved={$savedFeeds[podcast.title] !== undefined}
				on:addPodcast={addPodcast}
				on:removePodcast={removePodcast}
			/>
		{/each}
	</div>
</div>

<style>
	.podcast-query-container {
		margin-bottom: 2rem;
	}

	.podcast-query-results {
		width: 100%;
		height: 100%;
		display: grid;
		grid-gap: 1rem;
	}

	.grid-3 {
		grid-template-columns: repeat(3, 1fr);
	}

	.grid-2 {
		grid-template-columns: repeat(2, 1fr);
	}

	.grid-1 {
		grid-template-columns: repeat(1, 1fr);
	}
</style>
