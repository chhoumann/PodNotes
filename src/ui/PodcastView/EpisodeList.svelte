<script lang="ts">
	import { Episode } from "src/types/Episode";
	import { PodcastFeed } from "src/types/PodcastFeed";
	import { createEventDispatcher, onMount } from "svelte";
	import EpisodeListItem from "./EpisodeListItem.svelte";
	import { playedEpisodes } from "src/store";
	import Icon from "../Icon.svelte";

	export let episodes: Episode[] = [];
	export let feed: PodcastFeed | null = null;
	let hidePlayedEpisodes: boolean = false;

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

	<div class="episode-list-menu">
		<Icon 
			icon={hidePlayedEpisodes ? "eye-off" : "eye"}
			size={25}
			on:click={() => hidePlayedEpisodes = !hidePlayedEpisodes}
		/>
		<Icon
			 icon="refresh-cw"
			 size={25}
		/>
	</div>

	<div class="podcast-episode-list">
		{#each episodes as episode}
			{@const episodePlayed = $playedEpisodes[episode.title]?.finished}
			{#if !hidePlayedEpisodes || !episodePlayed}
				<EpisodeListItem
					episode={episode}
					episodeFinished={episodePlayed}
					on:clickEpisode={forwardClickEpisode} 
				/>
			{/if}
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

	.episode-list-menu {
		display: flex;
		flex-direction: row;
		justify-content: right;
		align-items: center;
		gap: 1rem;
		width: 100%;
		padding-left: 0.5rem;
		padding-right: 0.5rem;
	}
</style>

