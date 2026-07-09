<script lang="ts">
	import type { Episode } from "src/types/Episode";
	import { createEventDispatcher } from "svelte";
	import ImageLoader from "../common/ImageLoader.svelte";
	import Icon from "../obsidian/Icon.svelte";

	export let episode: Episode;
	export let episodeFinished: boolean = false;
	export let showEpisodeImage: boolean = false;
	export let unavailableReason: string | undefined = undefined;

	const dispatch = createEventDispatcher();
	const dateFormatter = new Intl.DateTimeFormat("en-GB", {
		day: "2-digit",
		month: "long",
		year: "numeric",
	});
	const formattedDateCache = new Map<string, string>();
	let overflowEl: HTMLDivElement;

	function onClickEpisode() {
		dispatch("clickEpisode", { episode });
	}

	function onContextMenu(event: MouseEvent) {
		dispatch("contextMenu", { episode, event });
	}

	// Open the same menu from the overflow button so it is reachable on mobile
	// (tap) and via keyboard, where right-click is unavailable. Anchor the menu
	// to the button's bounding box (the bound element, valid regardless of event
	// timing) instead of a MouseEvent; spawnEpisodeContextMenu accepts an {x, y}
	// position. Enter/Space activate the underlying <button> as a click.
	function onOverflowClick() {
		if (!overflowEl) return;
		const rect = overflowEl.getBoundingClientRect();
		dispatch("contextMenu", {
			episode,
			event: { x: rect.left, y: rect.bottom },
		});
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

<div class="podcast-episode-row">
	<button
		type="button"
		class="podcast-episode-item"
		on:click={onClickEpisode}
		on:contextmenu={onContextMenu}
		title={unavailableReason ?? episode.title}
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
			<span class={`episode-item-title ${episodeFinished && "strikeout"}`}
				>{episode.title}</span
			>
			{#if unavailableReason}
				<span class="episode-item-status">{unavailableReason}</span>
			{/if}
		</div>
	</button>

	<div class="podcast-episode-overflow" bind:this={overflowEl}>
		<Icon
			icon="more-vertical"
			size={20}
			label={`More options for ${episode.title}`}
			on:click={onOverflowClick}
		/>
	</div>
</div>

<style>
	.podcast-episode-row {
		position: relative;
		display: flex;
		align-items: stretch;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.podcast-episode-row:last-child {
		border-bottom: none;
	}

	.podcast-episode-item {
		display: flex;
		flex-direction: row;
		justify-content: flex-start;
		align-items: center;
		padding: 0.625rem 2.5rem 0.625rem 0.75rem;
		min-height: 4.5rem;
		width: 100%;
		border: none;
		gap: 0.75rem;
		background: transparent;
		text-align: left;
		cursor: pointer;
		transition: background-color 120ms ease;
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

	.podcast-episode-overflow {
		position: absolute;
		top: 50%;
		right: 0.25rem;
		transform: translateY(-50%);
		display: flex;
		align-items: center;
	}

	.podcast-episode-overflow :global(.icon-button) {
		padding: 0.35rem;
		border-radius: 0.375rem;
		color: var(--text-muted);
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}

	.podcast-episode-overflow :global(.icon-button:hover) {
		background-color: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.podcast-episode-overflow :global(.icon-button:focus-visible) {
		outline: 2px solid var(--interactive-accent);
		outline-offset: -2px;
	}

	.strikeout {
		text-decoration: line-through;
		opacity: 0.6;
	}

	.podcast-episode-item:has(.episode-item-status) {
		opacity: 0.75;
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

	.episode-item-status {
		font-size: 0.75rem;
		color: var(--text-muted);
	}
</style>
