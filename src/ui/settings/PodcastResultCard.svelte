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
				tooltip={`Remove ${podcast.title} podcast`}
				onclick={() => dispatch("removePodcast", { podcast })}
			/>
		{:else}
			<Button
				icon="plus"
				tooltip={`Add ${podcast.title} podcast`}
				onclick={() => dispatch("addPodcast", { podcast })}
			/>
		{/if}
	</div>
</div>

<style>
	.podcast-result-card {
		display: flex;
		align-items: center;
		padding: 16px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background-color: var(--background-secondary);
		max-width: 100%;
		transition: all 0.3s ease;
		position: relative;
	}

	.podcast-artwork-container {
		width: 70px;
		height: 70px;
		flex-shrink: 0;
		margin-right: 20px;
		overflow: hidden;
		border-radius: 4px;
		position: relative;
	}

	.podcast-artwork {
		width: 100%;
		height: 100%;
		object-fit: cover;
		position: absolute;
		top: 0;
		left: 0;
	}

	.podcast-result-card:hover {
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
		transform: translateY(-2px);
	}

	.podcast-info {
		flex-grow: 1;
		min-width: 0;
		padding-right: 12px;
	}

	.podcast-title {
		margin: 0 0 6px 0;
		font-size: 16px;
		font-weight: bold;
		line-height: 1.3;
		word-break: break-word;
	}

	.podcast-actions {
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}

	:global(.podcast-actions button) {
		padding: 4px;
		width: 24px;
		height: 24px;
	}

	:global(.podcast-actions button svg) {
		width: 16px;
		height: 16px;
	}
</style>
