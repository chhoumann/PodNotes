<script lang="ts">
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import type { FeedKey } from "src/services/FeedRepository";
	import { createEventDispatcher } from "svelte";

	export let key: FeedKey;
	export let feed: PodcastFeed;

	const dispatch = createEventDispatcher();
	let failedArtworkUrl = "";

	$: initials = feed.title
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 2)
		.map((word) => [...word][0])
		.join("")
		.toUpperCase();
</script>

<button
	type="button"
	class="podcast-card"
	aria-label={feed.title}
	on:click={() => dispatch("clickPodcast", { key, feed })}
>
	{#if feed.artworkUrl && feed.artworkUrl !== failedArtworkUrl}
		<img
			draggable="false"
			src={feed.artworkUrl}
			alt={feed.title}
			loading="lazy"
			class="podcast-image"
			on:error={() => (failedArtworkUrl = feed.artworkUrl)}
		/>
	{:else}
		<span class="podcast-image podcast-image-fallback">{initials}</span>
	{/if}
</button>

<style>
	.podcast-card {
		display: block;
		position: relative;
		width: 100%;
		height: 100%;
		padding: 0;
		overflow: hidden;
		border: none;
		background: var(--background-secondary);
		cursor: pointer;
	}

	.podcast-image {
		display: block;
		width: 100%;
		height: 100%;
		aspect-ratio: 1;
		object-fit: cover;
		border: 1px solid var(--background-modifier-border);
		border-radius: 0.5rem;
		transition:
			transform 150ms ease,
			box-shadow 150ms ease,
			border-color 150ms ease;
	}

	.podcast-image:hover {
		transform: scale(1.02);
		border-color: var(--interactive-accent);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.podcast-image:active {
		transform: scale(0.98);
	}

	.podcast-image-fallback {
		display: grid;
		place-items: center;
		color: var(--text-muted);
		font-size: 1.75rem;
		font-weight: var(--font-semibold);
	}
</style>
