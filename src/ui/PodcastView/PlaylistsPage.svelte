<script lang="ts">
	import { favorites, playlists } from "src/store";
	import { useServices } from "./context";
	import PlaylistCard from "./PlaylistCard.svelte";

	const { navigation } = useServices();
</script>

<div class="podcast-grid">
	{#each [$favorites, ...Object.values($playlists)] as playlist (playlist.name)}
		<PlaylistCard
			{playlist}
			on:clickPlaylist={() => navigation.go({ kind: "playlist", name: playlist.name })}
		/>
	{/each}
</div>

<style>
	/* The grid PodcastGrid lays its cards out in. */
	.podcast-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
		grid-auto-rows: min-content;
		gap: 0.5rem;
		padding: 0.5rem;
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
