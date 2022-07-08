<script lang="ts">
	import { PodcastFeed } from "src/types/PodcastFeed";
	import { createEventDispatcher } from "svelte";

	export let feeds: PodcastFeed[] = [];

	const dispatch = createEventDispatcher();

	function onclickPodcast(feed: PodcastFeed) {
		dispatch("clickPodcast", { feed });
	}
</script>

<div class="podcast-grid">
	{#if feeds.length > 0}
		{#each feeds as feed}
			<img
				id={feed.title}
				src={feed.artworkUrl}
				alt={feed.title}
				on:click={onclickPodcast.bind(null, feed)}
				class="podcast-image"
			/>
		{/each}
	{:else}
		<div>
			<p>No saved podcasts.</p>
		</div>
	{/if}
</div>

<style>
	.podcast-image {
		width: 100%;
		cursor: pointer !important;
	}

	.podcast-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-gap: 0rem;
	}
</style>
