<script lang="ts">
	import type { Episode } from "src/types/Episode";
	import type { PlayedEpisode } from "src/types/PlayedEpisode";
	import { formatSeconds } from "src/utility/formatSeconds";
	import { createEventDispatcher } from "svelte";
	import ImageLoader from "../common/ImageLoader.svelte";
	import Icon from "../obsidian/Icon.svelte";

	type EpisodeQuickAction =
		| "play"
		| "togglePlayed"
		| "download"
		| "note"
		| "favorite"
		| "queue";

	export let episode: Episode;
	export let episodeFinished: boolean = false;
	export let playedEpisode: PlayedEpisode | undefined = undefined;
	export let showEpisodeImage: boolean = false;
	export let unavailableReason: string | undefined = undefined;
	export let isDownloaded: boolean = false;
	export let isQueued: boolean = false;
	export let isFavorite: boolean = false;
	export let noteExists: boolean = false;

	const dispatch = createEventDispatcher<{
		clickEpisode: { episode: Episode };
		contextMenu: { episode: Episode; event: MouseEvent };
		quickAction: { episode: Episode; action: EpisodeQuickAction };
	}>();
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

	function onQuickAction(event: MouseEvent, action: EpisodeQuickAction) {
		event.stopPropagation();
		dispatch("quickAction", { episode, action });
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
	let durationText: string = "";
	let progressPercent: number = 0;
	let isPartiallyPlayed: boolean = false;
	let canUseEpisodeActions: boolean = true;

	$: date = formatEpisodeDate(episode);
	$: durationText = formatDuration(episode.duration ?? playedEpisode?.duration);
	$: progressPercent = getProgressPercent(playedEpisode);
	$: isPartiallyPlayed =
		!episodeFinished && Boolean(playedEpisode?.time && playedEpisode.time > 0);
	$: canUseEpisodeActions = !unavailableReason;

	function formatDuration(duration: number | undefined): string {
		if (!duration || duration <= 0) return "";

		return duration >= 3600
			? formatSeconds(duration, "H:mm:ss")
			: formatSeconds(duration, "m:ss");
	}

	function getProgressPercent(played: PlayedEpisode | undefined): number {
		if (!played?.time || !played.duration) return 0;

		return Math.min(99, Math.max(1, Math.round((played.time / played.duration) * 100)));
	}
</script>

<div
	class="podcast-episode-item"
	class:podcast-episode-item-unavailable={unavailableReason}
	role="group"
	aria-label={episode.title}
	on:contextmenu={onContextMenu}
	title={unavailableReason ?? episode.title}
>
	<button
		type="button"
		class="podcast-episode-main"
		on:click={onClickEpisode}
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
			<span class="episode-item-title" class:strikeout={episodeFinished}>{episode.title}</span>
			<div class="episode-item-meta" aria-label="Episode state">
				{#if durationText}
					<span class="episode-item-badge">
						<Icon icon="clock" size={14} clickable={false} />
						{durationText}
					</span>
				{/if}
				{#if episodeFinished}
					<span class="episode-item-badge episode-item-badge-strong">
						<Icon icon="check" size={14} clickable={false} />
						Played
					</span>
				{:else if isPartiallyPlayed}
					<span class="episode-item-badge">
						<Icon icon="timer" size={14} clickable={false} />
						{progressPercent ? `${progressPercent}%` : "In progress"}
					</span>
				{/if}
				{#if isDownloaded}
					<span class="episode-item-badge" aria-label="Downloaded">
						<Icon icon="download" size={14} clickable={false} />
					</span>
				{/if}
				{#if isQueued}
					<span class="episode-item-badge" aria-label="Queued">
						<Icon icon="list-ordered" size={14} clickable={false} />
					</span>
				{/if}
				{#if isFavorite}
					<span class="episode-item-badge" aria-label="Favorited">
						<Icon icon="lucide-star" size={14} clickable={false} />
					</span>
				{/if}
				{#if noteExists}
					<span class="episode-item-badge" aria-label="Podcast note exists">
						<Icon icon="file-text" size={14} clickable={false} />
					</span>
				{/if}
				{#if unavailableReason}
					<span class="episode-item-status">{unavailableReason}</span>
				{/if}
			</div>
		</div>
	</button>

	<div class="episode-quick-actions" aria-label={`Quick actions for ${episode.title}`}>
		<button
			type="button"
			class="episode-quick-action"
			aria-label="Play episode"
			title="Play"
			disabled={!canUseEpisodeActions}
			on:click={(event) => onQuickAction(event, "play")}
		>
			<Icon icon="play" size={16} clickable={false} />
		</button>
		<button
			type="button"
			class="episode-quick-action"
			aria-label={episodeFinished ? "Mark unplayed" : "Mark played"}
			title={episodeFinished ? "Mark unplayed" : "Mark played"}
			on:click={(event) => onQuickAction(event, "togglePlayed")}
		>
			<Icon icon={episodeFinished ? "x" : "check"} size={16} clickable={false} />
		</button>
		<button
			type="button"
			class="episode-quick-action"
			aria-label={isDownloaded ? "Remove downloaded file" : "Download episode"}
			title={isDownloaded ? "Remove file" : "Download"}
			disabled={!canUseEpisodeActions}
			on:click={(event) => onQuickAction(event, "download")}
		>
			<Icon icon={isDownloaded ? "x" : "download"} size={16} clickable={false} />
		</button>
		<button
			type="button"
			class="episode-quick-action"
			aria-label={noteExists ? "Open podcast note" : "Create podcast note"}
			title={noteExists ? "Open note" : "Create note"}
			disabled={!canUseEpisodeActions}
			on:click={(event) => onQuickAction(event, "note")}
		>
			<Icon icon={noteExists ? "file-text" : "file-plus"} size={16} clickable={false} />
		</button>
		<button
			type="button"
			class="episode-quick-action"
			aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
			title={isFavorite ? "Remove favorite" : "Favorite"}
			disabled={!canUseEpisodeActions}
			on:click={(event) => onQuickAction(event, "favorite")}
		>
			<Icon icon="lucide-star" size={16} clickable={false} />
		</button>
		<button
			type="button"
			class="episode-quick-action"
			aria-label={isQueued ? "Remove from queue" : "Add to queue"}
			title={isQueued ? "Remove from queue" : "Queue"}
			disabled={!canUseEpisodeActions}
			on:click={(event) => onQuickAction(event, "queue")}
		>
			<Icon icon={isQueued ? "list-x" : "list-plus"} size={16} clickable={false} />
		</button>
	</div>
</div>

<style>
	.podcast-episode-item {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		align-items: center;
		padding: 0.375rem 0.625rem 0.375rem 0.875rem;
		min-height: 3.875rem;
		width: 100%;
		border: none;
		border-bottom: 1px solid var(--background-modifier-border);
		gap: 0.625rem;
		background: transparent;
		text-align: left;
	}

	.podcast-episode-item:last-child {
		border-bottom: none;
	}

	.podcast-episode-item:focus-within {
		outline: 2px solid var(--interactive-accent);
		outline-offset: -2px;
		border-radius: 0.25rem;
	}

	.podcast-episode-item:hover,
	.podcast-episode-item:focus-within {
		background-color: var(--background-secondary-alt);
	}

	.podcast-episode-item:has(.podcast-episode-main:active),
	.podcast-episode-item:has(.episode-quick-action:active) {
		background-color: var(--background-modifier-border);
	}

	.podcast-episode-item-unavailable {
		opacity: 0.75;
	}

	.podcast-episode-main {
		appearance: none;
		display: flex;
		flex: 1 1 auto;
		align-items: center;
		gap: 0.625rem;
		min-width: 0;
		width: 100%;
		min-height: 0;
		padding: 0;
		margin: 0;
		border: none !important;
		border-radius: 0;
		background: transparent;
		box-shadow: none !important;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.podcast-episode-information {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
		gap: 0.1875rem;
		flex: 1 1 auto;
		min-width: 0;
	}

	.episode-item-date {
		font-size: 0.6875rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		color: var(--text-muted);
	}

	.episode-item-title {
		font-size: 0.9375rem;
		line-height: 1.3;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
	}

	.strikeout {
		text-decoration: line-through;
		opacity: 0.6;
	}

	.episode-item-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
		min-height: 1rem;
	}

	.episode-item-badge,
	.episode-item-status {
		display: inline-flex;
		align-items: center;
		gap: 0.1875rem;
		min-height: 1rem;
		padding: 0;
		border: none;
		border-radius: 0;
		font-size: 0.75rem;
		line-height: 1;
		color: var(--text-muted);
		background: transparent;
	}

	.episode-item-badge-strong {
		color: var(--text-accent);
		font-weight: 500;
	}

	.episode-item-status {
		padding: 0.125rem 0.375rem;
		border: 1px solid var(--background-modifier-border);
		border-radius: 999px;
		background: var(--background-secondary);
	}

	.episode-quick-actions {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 0.125rem;
		opacity: 0;
		pointer-events: none;
	}

	.podcast-episode-item:hover .episode-quick-actions,
	.podcast-episode-item:focus-within .episode-quick-actions {
		opacity: 1;
		pointer-events: auto;
	}

	.episode-quick-action {
		appearance: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1.75rem;
		height: 1.75rem;
		min-height: 1.75rem;
		padding: 0;
		border: none !important;
		border-radius: 0.375rem;
		color: var(--text-muted);
		background: transparent;
		box-shadow: none !important;
		cursor: pointer;
	}

	.episode-quick-action:hover,
	.episode-quick-action:focus-visible {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.episode-quick-action:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
	}

	.episode-quick-action:disabled {
		cursor: not-allowed;
		opacity: 0.45;
	}

	.podcast-episode-thumbnail-container {
		flex: 0 0 3rem;
		width: 3rem;
		height: 3rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background-secondary);
		border-radius: 0.375rem;
		overflow: hidden;
	}

	@media (min-width: 400px) {
		.podcast-episode-thumbnail-container {
			flex: 0 0 3.25rem;
			width: 3.25rem;
			height: 3.25rem;
		}
	}

	:global(.podcast-episode-thumbnail) {
		width: 100%;
		height: 100%;
		object-fit: cover;
		border-radius: 0.375rem;
	}

	@media (hover: none) {
		.episode-quick-actions {
			opacity: 1;
			pointer-events: auto;
		}
	}
</style>
