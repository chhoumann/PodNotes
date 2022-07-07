<script lang="ts">
	import { Episode } from "src/types/Episode";
	import { createEventDispatcher } from "svelte";

	export let episode: Episode;

	const dispatch = createEventDispatcher();

	function onClickEpisode() {
		dispatch("clickEpisode", { episode });
	}

	const _date = new Date(episode.episodeDate || "");
	const date = window.moment(_date).format("DD MMMM YYYY");
</script>

<style>
	.podcast-episode-item {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem;
		width: 100%;
	}

	.podcast-episode-item:hover {
		cursor: pointer;
	}

	.podcast-episode-information {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		align-items: left;
		width: 100%;
	}

	.episode-item-date {
		color: gray;
	}
</style>

<div 
	class="podcast-episode-item" 
	on:click={onClickEpisode} 
>
	<div class="podcast-episode-information">
		<span class="episode-item-date">{date.toUpperCase()}</span>
		<span class="episode-item-title">{episode.title}</span>
	</div>
</div>
