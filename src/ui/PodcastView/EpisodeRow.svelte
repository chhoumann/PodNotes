<script lang="ts">
	import type { Snippet } from "svelte";
	import type { Episode } from "src/types/Episode";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import { isPlaying } from "src/player/PlayerController";
	import { availabilityOf, episodeRowModel } from "./episodeRow";
	import { anchorOf, type MenuAnchor } from "./menus";

	let {
		episode,
		cover = false,
		date = !cover,
		resolved = true,
		queue = false,
		dragging = false,
		onplay,
		onmenu,
		leading,
		trailing,
	}: {
		episode: Episode;
		cover?: boolean;
		/** The episode's date. Rows with a cover name their source instead, except Latest's. */
		date?: boolean;
		/** False for a Played record that matched no episode. */
		resolved?: boolean;
		/** A queue row: centered, flush left, without a progress bar. */
		queue?: boolean;
		/** Lifted while its grip drags it. */
		dragging?: boolean;
		onplay(): void;
		onmenu(at: MenuAnchor): void;
		/** Before the row's button, such as the queue's grip. */
		leading?: Snippet;
		/** In place of the More button, such as the queue's remove button. */
		trailing?: Snippet;
	} = $props();
	const { player, library, rowHasNote, online } = useServices();
	const { playedEpisodes, downloadedEpisodes } = library;
	const playerState = player.state;
	// The player's state changes many times a second; a row changes only with these.
	const now = $derived($playerState.episode);
	const playing = $derived(isPlaying($playerState.status));
	// A vault lookup, so it runs again only when notes change, not on every change to the library.
	const noted = $derived($rowHasNote(episode));
	const row = $derived(
		episodeRowModel(episode, {
			played: $playedEpisodes,
			downloads: $downloadedEpisodes,
			now,
			playing,
			hasNote: noted,
			cover,
			date,
			availability: availabilityOf(episode, resolved, $online, $downloadedEpisodes),
		}),
	);
	const menu = (event: MouseEvent) => onmenu(anchorOf(event));
</script>

<div
	class="pn-ep"
	class:is-played={row.played}
	class:is-current={row.current}
	class:is-queue={queue}
	class:is-dragging={dragging}
	role="listitem"
>
	{@render leading?.()}
	<button
		type="button"
		class="pn-bare pn-ep-main"
		aria-label={row.label}
		aria-disabled={row.unavailable || undefined}
		onclick={onplay}
		oncontextmenu={menu}
	>
		{#if cover}
			<Cover src={episode.artworkUrl} title={episode.podcastName} tile={row.tile} />
		{/if}
		<span class="pn-ep-text">
			<span class="pn-ep-title">{episode.title}</span>
			<span class="pn-ep-meta">
				{#if row.current}
					<span class="pn-eq" class:paused={!row.playing}><i></i><i></i><i></i></span>
				{/if}
				{#if row.played}<span {@attach icon("check")}></span>{/if}
				{#if row.source}
					<span class="pod">{row.source}</span><span class="pn-brk"></span>
				{/if}
				{#each row.meta as text, index (index)}
					{#if index || row.source}<span class="sep">·</span>{/if}
					{#if row.progress !== undefined && index === row.meta.length - 1}
						<span class="pn-bar"><span style:width="{row.progress * 100}%"></span></span
						>
					{/if}
					<span>{text}</span>
				{/each}
				{#if row.unavailable}
					<span {@attach icon("cloud-off")}></span>
				{:else if row.downloaded}
					<span {@attach icon("arrow-down-to-line")}></span>
				{/if}
				{#if row.hasNote}<span {@attach icon("file-text")}></span>{/if}
			</span>
		</span>
	</button>
	{#if trailing}
		{@render trailing()}
	{:else}
		<button
			type="button"
			class="pn-iconbtn pn-ep-more"
			aria-label="More options for {episode.title}"
			aria-haspopup="menu"
			onclick={menu}
			oncontextmenu={menu}
			{@attach icon("more-vertical")}
		></button>
	{/if}
</div>

<style>
	.pn-ep :global {
		display: flex;
		align-items: flex-start;
		border-radius: var(--radius-s);

		@media (hover: hover) {
			&:hover {
				background: var(--background-modifier-hover);
			}

			&:hover button.pn-ep-more {
				opacity: 1;
			}
		}

		&.is-queue {
			align-items: center;
			gap: var(--size-2-2);
		}

		&.is-dragging {
			position: relative;
			z-index: 2;
			background: var(--pn-surface);
			box-shadow: var(--shadow-s);
		}

		/* Obsidian's buttons keep their text on one line; this one wraps its title. */
		.pn-ep-main {
			flex: 1;
			min-width: 0;
			display: flex;
			align-items: flex-start;
			gap: var(--size-4-3);
			height: auto;
			padding: var(--size-4-2) 0 var(--size-4-2) var(--size-4-2);
			border-radius: var(--radius-s);
			color: var(--text-normal);
			text-align: left;
			white-space: normal;
		}

		.pn-ep-main .pn-cover {
			width: 40px;
			margin-top: 1px;
			border-radius: 5px;
		}

		.pn-ep-text {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 3px;
		}

		/* A long title takes two lines and breaks anywhere, never under the button beside it. */
		.pn-ep-title {
			font-weight: var(--font-medium);
			line-height: 1.35;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
			overflow-wrap: anywhere;
		}

		.pn-ep-meta {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 3px 6px;
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-variant-numeric: tabular-nums;
			--icon-size: 13px;
			--icon-stroke: 2px;
		}

		.pn-ep-meta .sep {
			color: var(--text-faint);
		}

		.pn-ep-meta .pod {
			min-width: 0;
			overflow-wrap: anywhere;
		}

		.pn-brk {
			flex-basis: 100%;
			height: 0;
		}

		.pn-brk + .sep {
			display: none;
		}

		.pn-bar {
			width: 32px;
			height: 3px;
			border-radius: 2px;
			background: var(--background-modifier-border-hover);
			overflow: hidden;
		}

		.pn-bar span {
			display: block;
			height: 100%;
			background: var(--interactive-accent);
		}

		button.pn-ep-more {
			margin: var(--size-4-2) var(--size-2-2) 0 0;
			opacity: 0.55;
		}

		button.pn-ep-more:focus-visible {
			opacity: 1;
		}

		.pn-eq {
			display: flex;
			align-items: flex-end;
			gap: 1.5px;
			height: 10px;
		}

		.pn-eq i {
			width: 2px;
			height: 100%;
			border-radius: 1px;
			background: currentColor;
			transform-origin: bottom;
			animation: pn-eq 1s ease-in-out infinite;
		}

		.pn-eq i:first-child {
			animation-delay: -0.2s;
		}

		.pn-eq i:last-child {
			animation-delay: -0.8s;
		}

		.pn-eq.paused i {
			animation: none;
			transform: scaleY(0.6);
		}

		&.is-queue {
			.pn-ep-main {
				align-items: center;
				padding-left: 0;
			}

			.pn-ep-main .pn-cover {
				margin-top: 0;
			}

			.pn-bar {
				display: none;
			}
		}

		&.is-played .pn-ep-title {
			color: var(--text-muted);
			font-weight: var(--font-normal);
		}

		&.is-current :is(.pn-ep-title, .pn-ep-meta) {
			color: var(--text-accent);
		}

		.is-wide & {
			.pn-ep-meta {
				flex-wrap: nowrap;
				white-space: nowrap;
			}

			.pn-ep-meta > * {
				flex: none;
			}

			.pn-ep-meta .pod {
				flex: 0 1 auto;
				min-width: 24px;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.pn-brk {
				display: none;
			}

			.pn-brk + .sep {
				display: inline;
			}
		}

		.is-phone & {
			.pn-ep-main {
				padding-top: var(--size-4-3);
				padding-bottom: var(--size-4-3);
			}

			.pn-ep-main .pn-cover {
				width: 48px;
			}

			button.pn-ep-more {
				margin-top: var(--size-4-1);
			}
		}
	}

	/* Global, because a scoped keyframes rule scopes every element of the component. */
	:global {
		@keyframes pn-eq {
			0%,
			100% {
				transform: scaleY(0.4);
			}
			50% {
				transform: scaleY(1);
			}
		}
	}
</style>
