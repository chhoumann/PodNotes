<script lang="ts">
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import { createEventDispatcher } from "svelte";
	import Button from "../obsidian/Button.svelte";
	import { fade } from "svelte/transition";

	export let podcast: PodcastFeed;
	export let isSaved = false;

	const dispatch = createEventDispatcher();
</script>

<div class="podcast-result-card" transition:fade={{ duration: 300 }}>
	<div class="podcast-artwork-container">
		<img
			src={podcast.artworkUrl}
			alt={`Artwork for ${podcast.title}`}
			class="podcast-artwork"
		/>
	</div>
	<div class="podcast-info">
		<h3 class="podcast-title">{podcast.title}</h3>
	</div>
	<div class="podcast-actions">
		{#if isSaved}
			<Button
				icon="trash"
				ariaLabel={`Remove ${podcast.title} podcast`}
				on:click={() => dispatch("removePodcast", { podcast })}
			/>
		{:else}
			<Button
				icon="plus"
				ariaLabel={`Add ${podcast.title} podcast`}
				on:click={() => dispatch("addPodcast", { podcast })}
			/>
		{/if}
	</div>
</div>

<style>
	.podcast-result-card {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		padding: 0.875rem;
		border: 1px solid var(--background-modifier-border);
		border-radius: 0.5rem;
		background-color: var(--background-secondary);
		max-width: 100%;
		transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease;
	}

	.podcast-result-card:hover {
		border-color: var(--interactive-accent);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
		transform: translateY(-1px);
	}

	.podcast-artwork-container {
		width: 4rem;
		height: 4rem;
		flex-shrink: 0;
		overflow: hidden;
		border-radius: 0.375rem;
		position: relative;
		background: var(--background-modifier-border);
	}

	.podcast-artwork {
		width: 100%;
		height: 100%;
		object-fit: cover;
		position: absolute;
		top: 0;
		left: 0;
	}

	.podcast-info {
		flex: 1 1 auto;
		min-width: 0;
	}

	.podcast-title {
		margin: 0;
		font-size: 0.9rem;
		font-weight: 600;
		line-height: 1.4;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.podcast-actions {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	:global(.podcast-actions button) {
		padding: 0.375rem;
		border-radius: 0.25rem;
		transition: background-color 120ms ease;
	}

	:global(.podcast-actions button:hover) {
		background-color: var(--background-modifier-hover);
	}
</style>
