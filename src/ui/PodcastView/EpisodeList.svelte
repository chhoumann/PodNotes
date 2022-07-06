<script lang="ts">
	import { Episode } from "src/types/Episode";
import { PodcastFeed } from "src/types/PodcastFeed";
	import EpisodeListItem from "./EpisodeListItem.svelte";

	export let episodes: Episode[] = [];
	export let feed: PodcastFeed | null = null;
</script>

<style>
	.podcast-header {
		display: flex;
		flex-direction: column;
		justify-content: space-around;
		align-items: center;
		padding: 0.5rem;
	}

	#podcast-header {
		text-align: center;
	}

	.podcast-episode-list {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}
</style>

<div>
	<div class="podcast-header">
		<img id="podcast-artwork" src={feed?.artworkUrl} alt={feed?.title} />
		<h2 id="podcast-header">{feed?.title}</h2>
	</div>

	<div class="podcast-episode-list">
		{#each episodes as episode}
			<EpisodeListItem episode={episode} />
		{/each}
	</div>
</div>
