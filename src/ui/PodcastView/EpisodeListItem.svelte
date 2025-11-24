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
				width="100%"
				height="100%"
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
		align-items: center;
		padding: 0.625rem 0.75rem;
		min-height: 4.5rem;
		width: 100%;
		border: none;
		border-bottom: 1px solid var(--background-modifier-border);
		gap: 0.75rem;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease;
	}

	.podcast-episode-item:last-child {
		border-bottom: none;
	}

	.podcast-episode-item:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: -2px;
		border-radius: 0.25rem;
	}

	.podcast-episode-item:hover {
		background-color: var(--background-secondary-alt);
	}

	.podcast-episode-item:active {
		background-color: var(--background-modifier-border);
	}

	.strikeout {
		text-decoration: line-through;
		opacity: 0.6;
	}

	.podcast-episode-information {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 0.25rem;
		flex: 1 1 auto;
		min-width: 0;
	}

	.episode-item-date {
		font-size: 0.75rem;
		font-weight: 500;
		letter-spacing: 0.025em;
		color: var(--text-muted);
	}

	.episode-item-title {
		font-size: 0.9rem;
		line-height: 1.4;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.podcast-episode-thumbnail-container {
		flex: 0 0 3.5rem;
		width: 3.5rem;
		height: 3.5rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background-secondary);
		border-radius: 0.375rem;
		overflow: hidden;
	}

	@media (min-width: 400px) {
		.podcast-episode-thumbnail-container {
			flex: 0 0 4rem;
			width: 4rem;
			height: 4rem;
		}
	}

	:global(.podcast-episode-thumbnail) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 0.375rem;
	}
</style>
