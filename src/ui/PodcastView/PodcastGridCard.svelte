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
		/* Optimize animations with transform instead of box-shadow */
		transition: transform 0.15s ease, border-color 0.15s ease;
		will-change: transform;
		/* Force hardware acceleration */
		transform: translateZ(0);
	}

	.podcast-grid-item:hover {
		/* Use transform for better performance */
		transform: translateZ(0) scale(1.05);
		border-color: var(--interactive-hover);
		z-index: 1;
	}

	.podcast-grid-item:active {
		transform: translateZ(0) scale(0.98);
	}

	:global(.podcast-image) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
</style>