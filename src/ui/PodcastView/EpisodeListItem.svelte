<script lang="ts">
	import type { Episode } from "src/types/Episode";
	import { createEventDispatcher } from "svelte";
	import ImageLoader from "../common/ImageLoader.svelte";

	export let episode: Episode;
	export let episodeFinished: boolean = false;
	export let showEpisodeImage: boolean = false;

	const dispatch = createEventDispatcher();
	const dateFormatter = new Intl.DateTimeFormat("en-GB", {
		day: "2-digit",
		month: "long",
		year: "numeric"
	});
	const formattedDateCache = new Map<string, string>();

	function onClickEpisode() {
		dispatch("clickEpisode", { episode });
	}

	function onContextMenu(event: MouseEvent) {
		dispatch("contextMenu", { episode, event });
	}

	function parseEpisodeDate(rawDate?: Date | string): Date | null {
		if (!rawDate) return null;
		const parsedDate = new Date(rawDate);
		return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
	}

	function getCacheKey(ep: Episode, parsedDate: Date): string {
		const identifier = ep.url ?? ep.streamUrl ?? ep.title ?? "episode";
		return `${identifier}|${parsedDate.getTime()}`;
	}

	function formatEpisodeDate(ep: Episode): string {
		const parsedDate = parseEpisodeDate(ep?.episodeDate);
		if (!parsedDate) return "";

		const cacheKey = getCacheKey(ep, parsedDate);
		const cachedDate = formattedDateCache.get(cacheKey);
		if (cachedDate) return cachedDate;

		const formattedDate = dateFormatter.format(parsedDate).toUpperCase();
		formattedDateCache.set(cacheKey, formattedDate);
		return formattedDate;
	}

	let date: string = "";

	$: date = formatEpisodeDate(episode);
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
	<div class="podcast-episode-information">
		<span class="episode-item-date">{date}</span>
		<span class={`episode-item-title ${episodeFinished && "strikeout"}`}>{episode.title}</span>
	</div>
</button>

<style>
	.podcast-episode-item {
		display: flex;
		flex-direction: row;
		justify-content: flex-start;
		align-items: flex-start;
		padding: 0.5rem;
		min-height: 5rem;
		width: 100%;
		border: solid 1px var(--background-divider);
		gap: 0.75rem;
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
		align-items: flex-start;
		flex: 1 1 auto;
		min-width: 0;
	}

	.episode-item-date {
		color: gray;
	}

	.podcast-episode-thumbnail-container {
		flex: 0 0 5rem;
		width: 5rem;
		height: 5rem;
		max-width: 5rem;
		max-height: 5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background-secondary);
		border-radius: 15%;
		overflow: hidden;
	}

	:global(.podcast-episode-thumbnail) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 15%;
		cursor: pointer !important;
	}
</style>
