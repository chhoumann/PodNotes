<script lang="ts">
	import type { PodcastFeed } from "src/types/PodcastFeed";
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
	interactive={true}
    on:click={onclickPodcast.bind(null, feed)}
    class="podcast-image"
/>

<style>
	:global(.podcast-image) {
		width: 100%;
		height: 100%;
		aspect-ratio: 1;
		cursor: pointer !important;
		object-fit: cover;
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		border: 1px solid var(--background-modifier-border);
		border-radius: 0.5rem;
		transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
	}

	:global(.podcast-image:hover) {
		transform: scale(1.02);
		border-color: var(--interactive-accent);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	:global(.podcast-image:active) {
		transform: scale(0.98);
	}
</style>
