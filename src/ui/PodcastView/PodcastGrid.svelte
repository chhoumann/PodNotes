<script lang="ts">
	import type { Playlist } from "src/types/Playlist";
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import PlaylistCard from "./PlaylistCard.svelte";
	import PodcastGridCard from "./PodcastGridCard.svelte";
	import { createEventDispatcher } from "svelte";

	export let feeds: PodcastFeed[] = [];
	export let playlists: Playlist[] = [];

	const dispatch = createEventDispatcher();

	function forwardClickPlaylist({detail: {playlist, event}}: CustomEvent<{event: MouseEvent, playlist: Playlist}>) {
		dispatch("clickPlaylist", { playlist, event });
	}
</script>

<div class="podcast-grid">
	{#if playlists.length > 0}
		{#each playlists as playlist (playlist.name)}
			<PlaylistCard playlist={playlist} on:clickPlaylist={forwardClickPlaylist} />
		{/each}
	{/if}

	{#if feeds.length > 0}
		{#each feeds as feed (feed.url)}
			<PodcastGridCard
				feed={feed}
				on:clickPodcast
			/>
		{/each}
	{:else}
		<div>
			<p>No saved podcasts.</p>
		</div>
	{/if}
</div>

<style>
	.podcast-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
		grid-auto-rows: min-content;
		gap: 0.5rem;
		padding: 0.5rem;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}

	@media (min-width: 400px) {
		.podcast-grid {
			grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
			gap: 0.75rem;
			padding: 0.75rem;
		}
	}

	@media (min-width: 600px) {
		.podcast-grid {
			grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		}
	}
</style>
