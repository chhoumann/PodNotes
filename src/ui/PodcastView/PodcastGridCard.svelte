<script lang="ts">
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import { createEventDispatcher } from "svelte";
	import Image from "../common/Image.svelte";

	export let feed: PodcastFeed;

	const dispatch = createEventDispatcher();

	// Create handler once, not on every render
	function handleClick() {
		dispatch("clickPodcast", { feed });
	}
</script>

<button 
	type="button"
	class="podcast-grid-item"
	on:click={handleClick}
	aria-label={`Open ${feed.title} podcast`}
>
	<Image 
		src={feed.artworkUrl} 
		alt={feed.title}
		class="podcast-image"
	/>
</button>

<style>
	.podcast-grid-item {
		width: 100%;
		height: 100%;
		padding: 0;
		margin: 0;
		border: 1px solid var(--background-modifier-border);
		background: none;
		cursor: pointer;
		position: relative;
		overflow: hidden;
		/* Remove all transitions for maximum performance */
		/* transition: opacity 0.1s ease, border-color 0.1s ease; */
	}

	.podcast-grid-item:hover {
		/* Lighter hover effect for better performance */
		border-color: var(--interactive-hover);
		opacity: 0.9;
	}

	.podcast-grid-item:active {
		opacity: 0.7;
	}

	:global(.podcast-image) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
</style>