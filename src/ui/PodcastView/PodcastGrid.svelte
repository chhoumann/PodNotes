<script lang="ts">
	import type { Playlist } from "src/types/Playlist";
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import PlaylistCard from "./PlaylistCard.svelte";
	import PodcastGridCard from "./PodcastGridCard.svelte";
	import { createEventDispatcher } from "svelte";

	export let feeds: PodcastFeed[] = [];
	export let playlists: Playlist[] = [];

	const dispatch = createEventDispatcher();

	// Create handler once
	function handleClickPlaylist(event: CustomEvent<{event: MouseEvent, playlist: Playlist}>) {
		dispatch("clickPlaylist", event.detail);
	}
</script>

<div class="podcast-grid">
	{#if playlists.length > 0}
		<div class="playlist-section">
			{#each playlists as playlist (playlist.name)}
				<PlaylistCard {playlist} on:clickPlaylist={handleClickPlaylist} />
			{/each}
		</div>
	{/if}

	{#if feeds.length > 0}
		<div class="feeds-section">
			{#each feeds as feed (feed.url)}
				<PodcastGridCard
					{feed}
					on:clickPodcast
				/>
			{/each}
		</div>
	{:else}
		<div class="empty-state">
			<p>No saved podcasts.</p>
		</div>
	{/if}
</div>

<style>
	.podcast-grid {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem;
		overflow-y: auto;
		/* Enable smooth scrolling with GPU acceleration */
		-webkit-overflow-scrolling: touch;
		transform: translateZ(0);
	}

	.playlist-section,
	.feeds-section {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 0.5rem;
		/* Contain layout calculations */
		contain: layout style;
	}

	.empty-state {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 200px;
		color: var(--text-muted);
	}

	/* Optimize grid performance on mobile */
	@media (max-width: 768px) {
		.playlist-section,
		.feeds-section {
			grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		}
	}
</style>