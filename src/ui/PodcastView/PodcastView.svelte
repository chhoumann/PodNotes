<script lang="ts">
	import { Platform } from "obsidian";

	import { getFinishedPlayedEpisodeRecords } from "src/utility/episodeStatus";
	import { icon } from "../obsidian/icon";
	import { pickVaultMedia } from "../pickVaultMedia";
	import AddPodcastPage from "./AddPodcastPage.svelte";
	import { provideServices, type ShellServices } from "./context";

	import EpisodesPage from "./EpisodesPage.svelte";
	import {
		layoutFor,
		observeStatusBar,
		observeWidth,
		restoreScroll,
		type Layout,
	} from "./layout";
	import LibraryPage from "./LibraryPage.svelte";
	import ListPage from "./ListPage.svelte";
	import { anchorOf, playlistMenu, podcastMenu, queueMenu, showMenu } from "./menus";
	import MiniPlayer from "./MiniPlayer.svelte";
	import { activeRoot, headFor, pageExists, pageKey, type RootCounts } from "./pages";
	import Player from "./Player.svelte";
	import PlaylistsPage from "./PlaylistsPage.svelte";
	import QueueList from "./QueueList.svelte";
	import Rail from "./Rail.svelte";
	import SearchField from "./SearchField.svelte";

	let { services }: { services: ShellServices } = $props();
	// svelte-ignore state_referenced_locally
	provideServices(services);
	// svelte-ignore state_referenced_locally
	const { navigation, player, feeds, library, search, online, openSettings } = services;
	const { savedFeeds, queue, favorites, playlists, localFiles, playedEpisodes } = library;
	const playerState = player.state;

	let root: HTMLDivElement | undefined = $state();
	let layout = $state<Layout>("compact");
	let statusBar = $state(0);

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

	const head = $derived(
		headFor(page, layout, $navigation.stack[$navigation.stack.length - 1]?.page, $feeds, {
			queue: $queue,
			favorites: $favorites,
			playlists: $playlists,
			played: $playedEpisodes,
		}),
	);

	$effect(() => {
		void $savedFeeds;
		void feeds.ensureAll({ online: $online });
	});

	// A podcast or playlist removed while its page is open, or since the page was saved.
	$effect(() => {
		const playlistNames = new Set([$favorites.name, ...Object.keys($playlists)]);
		if (!pageExists(page, $feeds, playlistNames)) navigation.replace({ kind: "latest" });
	});
</script>

<div
	class="podcast-view"
	class:is-compact={layout === "compact"}
	class:is-wide={layout === "wide"}
	class:is-phone={Platform.isPhone}
	style:--pn-status-bar="{statusBar}px"
	bind:this={root}
	{@attach observeWidth((width) => {
		// A hidden leaf measures 0 wide; it keeps the layout it had.
		if (width > 0) layout = layoutFor(width);
	})}
	{@attach observeStatusBar((inset) => (statusBar = inset), services.app.workspace)}
>
	{#if firstRun}
		<div class="pn-first-run" inert={overlaid}>
			<button
				type="button"
				class="pn-iconbtn pn-first-settings"
				aria-label="PodNotes settings"
				onclick={openSettings}
				{@attach icon("settings")}
			></button>
			<AddPodcastPage firstRun={true} />
		</div>
	{:else}
		<div class="pn-body" class:pn-split={layout === "wide"} inert={overlaid}>
			{#if layout === "wide"}
				<Rail {counts} active={activeRoot(page)} />
			{/if}
			<main class="pn-main">
				{#if !$online}
					<div class="pn-strip" role="status">
						<span class="pn-strip-icon" {@attach icon("wifi-off")}></span>
						<span>Offline</span>
					</div>
				{/if}
				<header class="pn-head">
					{#if head.back}
						<button
							type="button"
							class={head.search ? "pn-iconbtn" : "pn-back"}
							aria-label="Back to {head.back}"
							onclick={() => navigation.back()}
						>
							<span class="pn-back-icon" {@attach icon("chevron-left")}></span>
							{#if !head.search}<span class="pn-back-label">{head.back}</span>{/if}
						</button>
					{/if}
					{#if head.search}
						<SearchField
							value={$search.query}
							placeholder="Search or paste a link"
							autofocus
							oninput={(value) => search.set(value)}
						/>
					{:else}
						{#if head.title}
							<h1 class="pn-head-title">{head.title}</h1>
							{#if head.flair}<span class="pn-flair">{head.flair}</span>{/if}
						{/if}
						<span class="pn-spacer"></span>
					{/if}
					{#if head.action === "library"}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Add podcast"
							onclick={() => navigation.go({ kind: "add" })}
							{@attach icon("plus")}
						></button>
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="PodNotes settings"
							onclick={openSettings}
							{@attach icon("settings")}
						></button>
					{:else if head.action === "refresh-all"}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Refresh all feeds"
							disabled={!$online}
							onclick={() => feeds.load($feeds.keys(), "network")}
							{@attach icon("refresh-cw")}
						></button>
					{:else if head.action === "podcast" && page.kind === "feed"}
						{@const key = page.key}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Podcast options"
							aria-haspopup="menu"
							onclick={(event) =>
								showMenu(podcastMenu(key, services), anchorOf(event))}
							{@attach icon("more-horizontal")}
						></button>
					{:else if head.action === "local"}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Add a vault file"
							onclick={() => pickVaultMedia(services.app)}
							{@attach icon("plus")}
						></button>
					{:else if head.action === "queue"}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Queue options"
							aria-haspopup="menu"
							onclick={(event) => showMenu(queueMenu(services), anchorOf(event))}
							{@attach icon("more-horizontal")}
						></button>
					{:else if head.action === "playlist" && page.kind === "playlist"}
						{@const name = page.name}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Playlist options"
							aria-haspopup="menu"
							onclick={(event) =>
								showMenu(playlistMenu(name, services), anchorOf(event))}
							{@attach icon("more-horizontal")}
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
						{#if head.pageTitle}
							<div class="pn-title">
								<h1>{head.pageTitle}</h1>
								{#if head.flair}<span class="pn-flair">{head.flair}</span>{/if}
							</div>
						{/if}
						{#if page.kind === "library"}
							<LibraryPage {layout} {counts} />
						{:else if page.kind === "add"}
							<AddPodcastPage firstRun={false} />
						{:else if page.kind === "playlists"}
							<PlaylistsPage />
						{:else if page.kind === "feed"}
							<EpisodesPage key={page.key} />
						{:else if page.kind === "queue"}
							<QueueList empty="Nothing here yet" />
						{:else}
							<ListPage {page} />
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
		<Player viewRoot={root} {layout} />
	{/if}
</div>

<style>
	/* The shell lays out the whole view, edge to edge. */
	:global(.view-content:has(> .podcast-view)) {
		padding: 0;
	}

	/* A long note or podcast name keeps an Undo notice to two lines, with Undo beside it. */
	:global(.notice-message:has(> .pn-undo)) {
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
	}

	:global(.notice .pn-undo-message) {
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	:global(.notice .pn-undo) {
		flex: none;
	}

	/* A prompt's field takes the rest of its row, so a feed address shows whole. */
	:global(.pn-prompt .setting-item-info) {
		flex: none;
	}

	:global(.pn-prompt .setting-item-control input) {
		width: 100%;
	}

	/* On a phone, Obsidian's navbar floats over the main area, and a mobile drawer
	   fades the bottom of a leaf. Neither may cover the mini player. A tablet has no
	   navbar. */
	:global(.is-phone.is-floating-nav .mod-root .view-content:has(> .podcast-view)) {
		padding-bottom: calc(var(--navbar-height) + var(--navbar-bottom-offset));
	}

	:global(
		.is-mobile.is-floating-nav .workspace-drawer .workspace-leaf-content:has(.pn-mini)::after
	) {
		display: none;
	}

	.podcast-view :global {
		--pn-bg: var(--background-primary);
		--pn-surface: var(--background-secondary);
		--pn-pad: var(--size-4-3);
		--pn-btn: 28px;
		--pn-row: 28px;
		--pn-head: 40px;
		--pn-cap-h: 36px;
		--pn-play: 52px;
		--pn-skip: 40px;
		position: relative;
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		font-size: var(--font-ui-small);
		line-height: var(--line-height-tight);

		/* A sidebar is secondary-colored. The mini player stands out from the page above it. */
		.mod-sidedock & {
			--pn-bg: var(--background-secondary);
		}

		.mod-sidedock &.is-compact {
			--pn-surface: var(--background-primary);
		}

		&.is-wide {
			--pn-pad: var(--size-4-6);
			--pn-head: 44px;
			--pn-cap-h: 38px;
			--pn-play: 56px;
		}

		&.is-phone {
			--pn-pad: var(--size-4-4);
			--pn-btn: 44px;
			--pn-row: 44px;
			--pn-head: 52px;
			--pn-cap-h: 48px;
			--pn-play: 64px;
			--pn-skip: 48px;
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
			--pn-bg: var(--background-primary);
			background: var(--pn-bg);
		}

		.pn-strip {
			flex: none;
			display: flex;
			align-items: center;
			gap: var(--size-4-2);
			height: 32px;
			padding: 0 var(--pn-pad);
			background: var(--background-modifier-border);
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-weight: var(--font-medium);
		}

		.pn-strip-icon {
			display: flex;
			--icon-size: 14px;
		}

		.pn-head {
			flex: none;
			display: flex;
			align-items: center;
			gap: var(--size-2-2);
			height: var(--pn-head);
			padding: 0 var(--size-4-2) 0 var(--size-4-1);
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

		.pn-head .pn-flair {
			align-self: center;
			margin-left: var(--size-4-2);
			padding-top: 3px;
		}

		.pn-head > .pn-search:first-child {
			margin-left: var(--size-4-3);
		}

		.pn-back {
			gap: var(--size-2-1);
			min-width: 0;
			max-width: 70%;
			height: var(--pn-btn);
			padding: 0 var(--size-4-2) 0 var(--size-2-1);
			border-radius: var(--radius-s);
			color: var(--text-muted);
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

		/* Less motion stops every transition and animation in the view, whatever rule set it. */
		@media (prefers-reduced-motion: reduce) {
			* {
				transition: none !important;
				animation: none !important;
			}
		}

		/* Without the mini player, a page ends under Obsidian's status bar. */
		&:not(:has(> .pn-mini)) .pn-scroll {
			padding-bottom: calc(var(--size-4-6) + var(--pn-status-bar));
		}

		&.is-wide {
			.pn-head {
				padding: 0 var(--size-4-4) 0 var(--size-4-3);
			}

			.pn-split .pn-head {
				height: 60px;
				padding-top: var(--size-4-1);
			}

			.pn-head-title {
				margin-left: var(--size-4-3);
				font-size: var(--font-ui-large);
				letter-spacing: -0.01em;
			}
		}

		/* Classes that several of the view's components share. */
		.pn-spacer {
			flex: 1;
		}

		.pn-h2 {
			margin: var(--size-4-5) 0 var(--size-4-2);
			font-size: var(--font-ui-small);
			font-weight: var(--font-semibold);
			color: var(--text-muted);
		}

		.pn-h2.is-first {
			margin-top: var(--size-4-1);
		}

		/* Undoes Obsidian's button skin, for a button drawn as its content. */
		.pn-bare,
		.pn-back,
		.pn-iconbtn,
		.pn-navitem {
			border: 0;
			background: none;
			box-shadow: none;
		}

		.pn-iconbtn {
			flex: none;
			width: var(--pn-btn);
			height: var(--pn-btn);
			padding: 0;
			border-radius: var(--radius-s);
			color: var(--icon-color);
			opacity: var(--icon-opacity);
		}

		/* A touch screen keeps a tapped control hovered until the next tap elsewhere. */
		@media (hover: hover) {
			:is(.pn-back, .pn-iconbtn):hover {
				background: var(--background-modifier-hover);
				color: var(--text-normal);
			}

			.pn-iconbtn:hover {
				opacity: var(--icon-opacity-hover);
			}

			.pn-btn.mod-cta:hover {
				background: var(--interactive-accent-hover);
			}

			.pn-navitem:hover {
				background: var(--nav-item-background-hover);
				color: var(--nav-item-color-hover);
			}
		}

		.pn-iconbtn:disabled {
			background: none;
			opacity: 0.7;
		}

		.pn-iconbtn[aria-pressed="true"] {
			color: var(--icon-color-active);
			opacity: 1;
		}

		.pn-btn {
			gap: var(--size-4-2);
			padding: 0 var(--size-4-3);
		}

		.pn-btn.mod-cta {
			background: var(--interactive-accent);
			color: var(--text-on-accent);
			box-shadow: none;
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
			gap: var(--size-4-2);
			width: 100%;
			height: auto;
			min-height: var(--pn-row);
			padding: var(--size-4-1) var(--size-4-2);
			border-radius: var(--radius-s);
			color: var(--nav-item-color);
			font-size: var(--nav-item-size);
			font-weight: inherit;
			text-align: left;
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

		.pn-flair {
			flex: none;
			color: var(--text-muted);
			font-size: var(--font-ui-small);
			white-space: nowrap;
			font-variant-numeric: tabular-nums;
		}

		.pn-navitem .pn-flair {
			font-size: var(--font-ui-smaller);
		}

		.pn-count {
			margin: var(--size-2-2) 0 var(--size-4-2);
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
		}

		.pn-panel-empty {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--size-4-3);
			padding: var(--size-4-8) var(--size-4-3);
			color: var(--text-muted);
			text-align: center;
		}

		.pn-panel-empty-icon {
			display: flex;
			--icon-size: 28px;
			--icon-stroke: 1.5px;
		}

		.pn-list {
			display: flex;
			flex-direction: column;
			margin: 0 calc(-1 * var(--size-4-2));
		}

		.pn-filetile {
			display: flex;
			align-items: center;
			justify-content: center;
			background: var(--background-modifier-border);
			color: var(--text-muted);
			--icon-size: 18px;
		}

		button:focus-visible {
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

		.pn-btn {
			height: 44px;
		}
	}
</style>
