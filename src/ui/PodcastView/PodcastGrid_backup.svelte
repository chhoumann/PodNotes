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
		{#each playlists as playlist}
			<PlaylistCard playlist={playlist} on:clickPlaylist={forwardClickPlaylist} />
		{/each}
	{/if}

	{#if feeds.length > 0}
		{#each feeds as feed}
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
 		grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
		grid-auto-flow: row;
		grid-auto-rows: 1fr;
		grid-gap: 0rem;
	}
</style>
