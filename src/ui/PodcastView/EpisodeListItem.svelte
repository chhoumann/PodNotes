<script lang="ts">
	import type { Episode } from "src/types/Episode";
	import { createEventDispatcher } from "svelte";
	import ImageLoader from "../common/ImageLoader.svelte";

	export let episode: Episode;
	export let episodeFinished: boolean = false;
	export let showEpisodeImage: boolean = false;

	const dispatch = createEventDispatcher();

	function onClickEpisode() {
		dispatch("clickEpisode", { episode });
	}

	function onContextMenu(event: MouseEvent) {
		dispatch("contextMenu", { episode, event });
	}

	let _date: Date;
	let date: string;

	$: {
		_date = new Date(episode.episodeDate || "");
		date = window.moment(_date).format("DD MMMM YYYY");
	}
</script>

<button
	type="button"
	class="podcast-episode-item" 
	on:click={onClickEpisode} 
	on:contextmenu={onContextMenu}
>
	{#if showEpisodeImage && episode?.artworkUrl} 
		<div class="podcast-episode-thumbnail-container">
			<ImageLoader
				src={episode.artworkUrl}
				alt={episode.title}
				fadeIn={true}
				width="5rem"
				height="5rem"
				class="podcast-episode-thumbnail"
			/>
		</div>
	{:else if showEpisodeImage}
		<div class="podcast-episode-thumbnail-container"></div>
	{/if}
	<div 
		class="podcast-episode-information" 
		style:flex-basis={"80%"}
	>
		<span class="episode-item-date">{date.toUpperCase()}</span>
		<span class={`episode-item-title ${episodeFinished && "strikeout"}`}>{episode.title}</span>
	</div>
</button>

<style>
	.podcast-episode-item {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		padding: 0.5rem;
		width: 100%;
		border: solid 1px var(--background-divider);
		gap: 0.25rem;
		background: transparent;
		text-align: left;
	}

	.podcast-episode-item:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 2px;
	}

	.podcast-episode-item:hover {
		background-color: var(--background-divider);
	}

	.strikeout {
		text-decoration: line-through;
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

	.podcast-episode-thumbnail-container {
		flex-basis: 20%;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	:global(.podcast-episode-thumbnail) {
		border-radius: 15%;
		max-width: 5rem;
		max-height: 5rem;
		cursor: pointer !important;
	}
</style>
