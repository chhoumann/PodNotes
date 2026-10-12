<script lang="ts">
	import { Platform } from "obsidian";
	import { onMount } from "svelte";
	import { favorites, localFiles, playedEpisodes, playlists, queue, savedFeeds } from "src/store";
	import { getFinishedPlayedEpisodeRecords } from "src/utility/episodeStatus";
	import { icon } from "../obsidian/icon";
	import AddPodcastPage from "./AddPodcastPage.svelte";
	import { provideServices, type ShellServices } from "./context";
	import EpisodesPage from "./EpisodesPage.svelte";
	import { layoutFor, observeWidth, restoreScroll, type Layout } from "./layout";
	import LibraryPage from "./LibraryPage.svelte";
	import MiniPlayer from "./MiniPlayer.svelte";
	import {
		activeRoot,
		isRoot,
		pageExists,
		pageKey,
		pageLabel,
		parentOf,
		rootItem,
		type RootCounts,
	} from "./pages";
	import PlayerOverlay from "./PlayerOverlay.svelte";
	import PlaylistsPage from "./PlaylistsPage.svelte";
	import Rail from "./Rail.svelte";

	let { services }: { services: ShellServices } = $props();
	// svelte-ignore state_referenced_locally
	provideServices(services);
	// svelte-ignore state_referenced_locally
	const { navigation, player, feeds, openSettings } = services;
	const playerState = player.state;

	let root: HTMLDivElement | undefined = $state();
	let layout = $state<Layout>("compact");

	const page = $derived($navigation.page);
	const counts: RootCounts = $derived({
		queue: $queue.episodes.length,
		playlists: 1 + Object.keys($playlists).length,
		local: $localFiles.episodes.length,
		played: getFinishedPlayedEpisodeRecords($playedEpisodes).length,
	});
	const libraryEmpty = $derived(
		Object.keys($savedFeeds).length === 0 &&
			Object.keys($playlists).length === 0 &&
			$favorites.episodes.length === 0 &&
			counts.queue === 0 &&
			counts.local === 0 &&
			counts.played === 0,
	);
	const firstRun = $derived(libraryEmpty && page.kind === "library");
	const loaded = $derived($playerState.status !== "empty");
	const overlaid = $derived(loaded && $navigation.expanded);

	const previous = $derived(
		$navigation.stack[$navigation.stack.length - 1]?.page ?? parentOf(page),
	);
	// The rail reaches every root in the wide layout, so a root there has no Back.
	const backLabel = $derived(
		previous && !(layout === "wide" && isRoot(page)) ? pageLabel(previous, $feeds) : undefined,
	);
	const headTitle = $derived(
		layout === "wide" && isRoot(page)
			? rootItem(page.kind).label
			: page.kind === "library"
				? pageLabel(page, $feeds)
				: undefined,
	);
	// A podcast's page is headed by its artwork and title inside the list.
	const pageTitle = $derived(
		page.kind === "playlist" ||
			(layout === "compact" && isRoot(page) && page.kind !== "library")
			? pageLabel(page, $feeds)
			: undefined,
	);

	onMount(() => savedFeeds.subscribe(() => void feeds.ensureAll()));

	// A podcast or playlist removed while its page is open, or since the page was saved.
	$effect(() => {
		const playlistNames = new Set([$favorites.name, ...Object.keys($playlists)]);
		if (!pageExists(page, $feeds, playlistNames)) navigation.goRoot("latest");
	});
</script>

<div
	class="podcast-view"
	class:is-compact={layout === "compact"}
	class:is-wide={layout === "wide"}
	class:is-phone={Platform.isPhone}
	bind:this={root}
	{@attach observeWidth((width) => {
		// A hidden leaf measures 0 wide; it keeps the layout it had.
		if (width > 0) layout = layoutFor(width);
	})}
>
	{#if firstRun}
		<div class="pn-first-run" inert={overlaid}>
			<button
				type="button"
				class="pn-iconbtn pn-first-settings"
				aria-label="PodNotes settings"
				title="PodNotes settings"
				onclick={openSettings}
				{@attach icon("settings")}
			></button>
			<div class="pn-scroll">
				<AddPodcastPage firstRun={true} />
			</div>
		</div>
	{:else}
		<div class="pn-body" class:pn-split={layout === "wide"} inert={overlaid}>
			{#if layout === "wide"}
				<Rail {counts} active={activeRoot(page)} />
			{/if}
			<main class="pn-main">
				<header class="pn-head">
					{#if backLabel}
						<button
							type="button"
							class="pn-back"
							aria-label="Back to {backLabel}"
							onclick={() => navigation.back()}
						>
							<span class="pn-back-icon" {@attach icon("chevron-left")}></span>
							<span class="pn-back-label">{backLabel}</span>
						</button>
					{/if}
					{#if headTitle}
						<h1 class="pn-head-title">{headTitle}</h1>
					{/if}
					<span class="pn-spacer"></span>
					{#if page.kind === "library" && layout === "compact"}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Add podcast"
							title="Add podcast"
							onclick={() => navigation.go({ kind: "add" })}
							{@attach icon("plus")}
						></button>
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="PodNotes settings"
							title="PodNotes settings"
							onclick={openSettings}
							{@attach icon("settings")}
						></button>
					{/if}
				</header>
				{#key pageKey(page)}
					<div
						class="pn-scroll"
						{@attach restoreScroll(() => navigation.current.scrollTop)}
						onscroll={(event) =>
							navigation.rememberScroll(event.currentTarget.scrollTop)}
					>
						{#if pageTitle}
							<div class="pn-title"><h1>{pageTitle}</h1></div>
						{/if}
						{#if page.kind === "library"}
							<LibraryPage {layout} {counts} />
						{:else if page.kind === "add"}
							<AddPodcastPage firstRun={false} />
						{:else if page.kind === "playlists"}
							<PlaylistsPage />
						{:else}
							<EpisodesPage {page} />
						{/if}
					</div>
				{/key}
			</main>
		</div>
	{/if}
	{#if loaded && !overlaid}
		<MiniPlayer {layout} />
	{/if}
	{#if overlaid && root}
		<PlayerOverlay viewRoot={root} />
	{/if}
</div>

<style>
	.podcast-view {
		--pn-bg: var(--background-primary);
		--pn-surface: var(--background-secondary);
		--pn-pad: var(--size-4-3);
		--pn-btn: 28px;
		--pn-row: 28px;
		--pn-head: 40px;
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		font-size: var(--font-ui-small);
		line-height: var(--line-height-tight);
	}

	/* The shell lays out the whole view, edge to edge. */
	:global(.view-content:has(> .podcast-view)) {
		padding: 0;
	}

	/* A sidebar is secondary-colored. The mini player stands out from the page above it. */
	:global(.mod-sidedock) .podcast-view {
		--pn-bg: var(--background-secondary);
	}

	:global(.mod-sidedock) .podcast-view.is-compact {
		--pn-surface: var(--background-primary);
	}

	.podcast-view.is-wide {
		--pn-pad: var(--size-4-6);
		--pn-head: 44px;
	}

	.podcast-view.is-phone {
		--pn-pad: var(--size-4-4);
		--pn-btn: 44px;
		--pn-row: 44px;
		--pn-head: 52px;
	}

	.pn-body {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
	}

	.pn-body.pn-split {
		display: grid;
		grid-template-columns: 216px minmax(0, 1fr);
	}

	.pn-main {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.pn-split .pn-main {
		background: var(--background-primary);
	}

	.pn-head {
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--size-2-2);
		height: var(--pn-head);
		padding: 0 var(--size-4-2) 0 var(--size-4-1);
	}

	.is-wide .pn-head {
		padding: 0 var(--size-4-4) 0 var(--size-4-3);
	}

	.pn-split .pn-head {
		height: 60px;
		padding-top: var(--size-4-1);
	}

	.pn-spacer {
		flex: 1;
	}

	.pn-head-title {
		margin: 0 0 0 var(--size-4-2);
		font-size: var(--font-ui-medium);
		line-height: 1.2;
		font-weight: var(--font-semibold);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.is-wide .pn-head-title {
		margin-left: var(--size-4-3);
		font-size: var(--font-ui-large);
		letter-spacing: -0.01em;
	}

	.pn-back {
		display: inline-flex;
		align-items: center;
		gap: var(--size-2-1);
		min-width: 0;
		max-width: 70%;
		height: var(--pn-btn);
		padding: 0 var(--size-4-2) 0 var(--size-2-1);
		border: 0;
		border-radius: var(--radius-s);
		background: none;
		box-shadow: none;
		color: var(--text-muted);
		font-size: var(--font-ui-small);
		cursor: var(--cursor);
	}

	.pn-back:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.pn-back-icon {
		display: flex;
		flex: none;
	}

	.pn-back-label {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pn-scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 var(--pn-pad) var(--size-4-6);
	}

	.pn-title {
		display: flex;
		align-items: baseline;
		gap: var(--size-4-2);
		min-width: 0;
		margin: var(--size-4-1) 0 var(--size-4-3);
	}

	.pn-title h1 {
		margin: 0;
		font-size: var(--font-ui-large);
		font-weight: var(--font-semibold);
		line-height: 1.2;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pn-first-run {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.pn-first-run .pn-first-settings {
		position: absolute;
		top: var(--size-4-1);
		right: var(--size-4-2);
	}

	/* Legacy pages scroll inside themselves. In the shell the page's scroller
	   scrolls them instead, so Back can restore where a page was. */
	.pn-scroll :global(.podcast-grid),
	.pn-scroll :global(.episode-list-view-container),
	.pn-scroll :global(.podcast-episode-list) {
		height: auto;
		overflow: visible;
	}

	.podcast-view :global {
		.pn-h2 {
			margin: var(--size-4-5) 0 var(--size-4-2);
			font-size: var(--font-ui-small);
			font-weight: var(--font-semibold);
			color: var(--text-muted);
		}

		.pn-iconbtn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			flex: none;
			width: var(--pn-btn);
			height: var(--pn-btn);
			padding: 0;
			border: 0;
			border-radius: var(--radius-s);
			background: transparent;
			box-shadow: none;
			color: var(--icon-color);
			opacity: var(--icon-opacity);
			cursor: var(--cursor);
		}

		.pn-iconbtn:hover {
			background: var(--background-modifier-hover);
			color: var(--text-normal);
			opacity: var(--icon-opacity-hover);
		}

		.pn-btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: var(--size-4-2);
			height: var(--input-height);
			padding: 0 var(--size-4-3);
			border: 0;
			border-radius: var(--button-radius);
			font-size: var(--font-ui-small);
			white-space: nowrap;
			cursor: var(--cursor);
		}

		.pn-btn.mod-cta {
			background: var(--interactive-accent);
			color: var(--text-on-accent);
			box-shadow: none;
		}

		.pn-btn.mod-cta:hover {
			background: var(--interactive-accent-hover);
		}

		.pn-btn-icon {
			display: flex;
			--icon-size: var(--icon-s);
			--icon-stroke: var(--icon-s-stroke-width);
		}

		.pn-nav {
			display: flex;
			flex-direction: column;
			gap: 1px;
		}

		.pn-scroll > .pn-nav {
			margin: 0 calc(-1 * var(--size-4-2));
		}

		.pn-navitem {
			display: flex;
			align-items: center;
			gap: var(--size-4-2);
			width: 100%;
			height: auto;
			min-height: var(--pn-row);
			padding: var(--size-4-1) var(--size-4-2);
			border: 0;
			border-radius: var(--radius-s);
			background: none;
			box-shadow: none;
			color: var(--nav-item-color);
			font-size: var(--nav-item-size);
			font-weight: inherit;
			text-align: left;
			cursor: var(--cursor);
		}

		.pn-navitem:hover {
			background: var(--nav-item-background-hover);
			color: var(--nav-item-color-hover);
		}

		.pn-navitem.is-active {
			background: var(--background-modifier-border);
			color: var(--nav-item-color-active);
			font-weight: var(--nav-item-weight-active);
		}

		.pn-navicon {
			display: flex;
			color: var(--icon-color);
			--icon-size: var(--icon-s);
			--icon-stroke: var(--icon-s-stroke-width);
		}

		.pn-navitem .lbl {
			flex: 1;
			min-width: 0;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.pn-navitem .flair {
			padding: 0;
			background: none;
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-variant-numeric: tabular-nums;
		}

		.pn-iconbtn:focus-visible,
		.pn-btn:focus-visible,
		.pn-navitem:focus-visible,
		.pn-back:focus-visible,
		.pn-railsearch:focus-visible,
		.pn-mini-open:focus-visible {
			outline: 2px solid var(--interactive-accent);
			outline-offset: 1px;
			box-shadow: none;
		}
	}

	.is-phone :global {
		.pn-navitem {
			gap: var(--size-4-3);
			padding: 0 var(--size-4-2);
		}

		.pn-navicon {
			--icon-size: 20px;
		}
	}
</style>
