<script lang="ts">
	import { useServices } from "./context";
	import PlaylistCard from "./PlaylistCard.svelte";
	import PodcastGrid from "./PodcastGrid.svelte";

	const { navigation, library } = useServices();
	const { favorites, playlists } = library;
	const lists = $derived([$favorites, ...Object.values($playlists)]);
</script>

<PodcastGrid>
	{#each lists as playlist (playlist.name)}
		<PlaylistCard
			{playlist}
			on:clickPlaylist={() => navigation.go({ kind: "playlist", name: playlist.name })}
		/>
	{/each}
</PodcastGrid>
