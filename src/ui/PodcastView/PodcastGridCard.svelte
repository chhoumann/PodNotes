<script lang="ts">
	import { PodcastFeed } from "src/types/PodcastFeed";
	import { createEventDispatcher } from "svelte";
	import Image from "../common/Image.svelte";

	export let feed: PodcastFeed;

	const dispatch = createEventDispatcher();

	function onclickPodcast(feed: PodcastFeed) {
		dispatch("clickPodcast", { feed });
	}
</script>

<Image 
	src={feed.artworkUrl} 
	alt={feed.title} 
    on:click={onclickPodcast.bind(null, feed)}
    class="podcast-image"
/>

<style>
	:global(.podcast-image) {
		width: 100%;
		height: 100%;
		cursor: pointer !important;
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		border: 1px solid var(--background-modifier-border);
	}
</style>
