<script lang="ts">
	import { Episode } from "src/types/Episode";
	import { PodcastFeed } from "src/types/PodcastFeed";
	import { createEventDispatcher } from "svelte";
	import EpisodeListItem from "./EpisodeListItem.svelte";

	export let episodes: Episode[] = [];
	export let feed: PodcastFeed | null = null;

	const dispatch = createEventDispatcher();

	function forwardClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		dispatch("clickEpisode", { episode: event.detail.episode });
	}
</script>

<div class="episode-list-view-container">
	<div class="podcast-header">
		<img id="podcast-artwork" src={feed?.artworkUrl} alt={feed?.title} />
		<h2 class="podcast-heading">{feed?.title}</h2>
	</div>

	<div class="podcast-episode-list">
		{#each episodes as episode}
			<EpisodeListItem episode={episode} on:clickEpisode={forwardClickEpisode} />
		{/each}
	</div>
</div>

<style>
	.episode-list-view-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.podcast-header {
		display: flex;
		flex-direction: column;
		justify-content: space-around;
		align-items: center;
		padding: 0.5rem;
	}

	.podcast-heading {
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
