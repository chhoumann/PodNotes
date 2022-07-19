<script lang="ts">
	import { Playlist } from "src/types/Playlist";
	import { PodcastFeed } from "src/types/PodcastFeed";
	import PlaylistCard from "./PlaylistCard.svelte";
	import PodcastGridCard from "./PodcastGridCard.svelte";

	export let feeds: PodcastFeed[] = [];
	export let playlists: Playlist[] = [];
</script>

<div class="podcast-grid">
	{#if playlists.length > 0}
		{#each playlists as playlist}
			<PlaylistCard playlist={playlist} />
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
 		grid-template-columns: repeat(3, minmax(0, 1fr));
		grid-auto-flow: row;
		grid-auto-rows: 1fr;
		grid-gap: 0rem;
	}
</style>
