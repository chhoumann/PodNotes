<script lang="ts">
	import { Platform } from "obsidian";
	import { onMount } from "svelte";

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
	import PlayerOverlay from "./PlayerOverlay.svelte";
	import PlaylistsPage from "./PlaylistsPage.svelte";
	import QueuePage from "./QueuePage.svelte";
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

	onMount(() => savedFeeds.subscribe(() => void feeds.ensureAll()));

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
	{@attach observeStatusBar((inset) => (statusBar = inset))}
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
							title={head.search && `Back to ${head.back}`}
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
							{#if head.flair}<span class="flair">{head.flair}</span>{/if}
						{/if}
						<span class="pn-spacer"></span>
					{/if}
					{#if head.action === "library"}
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
					{:else if head.action === "refresh-all"}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Refresh all feeds"
							title="Refresh all feeds"
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
							title="Podcast options"
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
							title="Add a vault file"
							onclick={() => pickVaultMedia(services.app)}
							{@attach icon("plus")}
						></button>
					{:else if head.action === "queue"}
						<button
							type="button"
							class="pn-iconbtn"
							aria-label="Queue options"
							title="Queue options"
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
							title="Playlist options"
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
								{#if head.flair}<span class="flair">{head.flair}</span>{/if}
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
							<QueuePage />
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

	/* The Undo button at the end of a Notice the view's actions show. */
	:global(.notice .pn-undo) {
		margin-left: var(--size-4-2);
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

	.is-wide .pn-head {
		padding: 0 var(--size-4-4) 0 var(--size-4-3);
	}

	.pn-split .pn-head {
		height: 60px;
		padding-top: var(--size-4-1);
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

	/* Without the mini player, a page ends under Obsidian's status bar. */
	.podcast-view:not(:has(> :global(.pn-mini))) .pn-scroll {
		padding-bottom: calc(var(--size-4-6) + var(--pn-status-bar));
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

	.podcast-view :global {
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

		.pn-iconbtn:disabled {
			background: none;
			opacity: 0.35;
			cursor: default;
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

		/* Obsidian styles .flair as an uppercase tag; here it is plain muted text. */
		.flair {
			flex: none;
			margin-inline-start: 0;
			padding: 0;
			background: none;
			letter-spacing: normal;
			text-transform: none;
			color: var(--text-muted);
			font-size: var(--font-ui-small);
			white-space: nowrap;
			font-variant-numeric: tabular-nums;
		}

		.pn-head .flair {
			align-self: center;
			margin-left: var(--size-4-2);
			padding-top: 3px;
		}

		.pn-navitem .flair {
			font-size: var(--font-ui-smaller);
		}

		.pn-back,
		.pn-alt {
			display: inline-flex;
			align-items: center;
			height: var(--pn-btn);
			border: 0;
			border-radius: var(--radius-s);
			background: none;
			box-shadow: none;
			color: var(--text-muted);
			font-size: var(--font-ui-small);
			cursor: var(--cursor);
		}

		.pn-back:hover,
		.pn-alt:hover {
			background: var(--background-modifier-hover);
			color: var(--text-normal);
		}

		.pn-back {
			gap: var(--size-2-1);
			min-width: 0;
			max-width: 70%;
			padding: 0 var(--size-4-2) 0 var(--size-2-1);
		}

		.pn-alt {
			gap: var(--size-4-2);
			padding: 0 var(--size-4-2);
		}

		.pn-alt > span {
			display: flex;
			--icon-size: var(--icon-s);
			--icon-stroke: var(--icon-s-stroke-width);
		}

		.pn-alts {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: var(--size-2-2);
			margin-top: var(--size-4-4);
		}

		.pn-scroll > .pn-alts {
			align-items: flex-start;
			margin-top: var(--size-4-2);
		}

		.pn-search {
			position: relative;
			flex: 1;
			min-width: 0;
		}

		.pn-search-icon {
			position: absolute;
			left: var(--size-4-2);
			top: 50%;
			transform: translateY(-50%);
			display: flex;
			color: var(--text-muted);
			pointer-events: none;
			--icon-size: var(--icon-xs);
			--icon-stroke: var(--icon-xs-stroke-width);
		}

		.pn-input {
			width: 100%;
			padding: 0 28px;
		}

		.pn-input::placeholder {
			color: var(--text-muted);
		}

		.pn-input::-webkit-search-cancel-button {
			display: none;
		}

		.pn-clear {
			position: absolute;
			right: 2px;
			top: 50%;
			transform: translateY(-50%);
			width: 24px;
			height: 24px;
		}

		.pn-head > .pn-search:first-child {
			margin-left: var(--size-4-3);
		}

		.pn-cover {
			display: block;
			flex: none;
			width: 100%;
			aspect-ratio: 1;
			border-radius: 6px;
			object-fit: cover;
		}

		.pn-cover.is-text {
			display: flex;
			align-items: flex-end;
			overflow: hidden;
			background: var(--background-modifier-border);
			color: var(--text-muted);
			font-weight: var(--font-bold);
			line-height: 1;
			text-align: left;
			overflow-wrap: anywhere;
			container-type: inline-size;
		}

		/* cqw is the cover's width. A percentage padding on the cover is its row's. */
		.pn-cover.is-text > span {
			padding: 10cqw;
			font-size: 12cqw;
		}

		.pn-empty {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			display: flex;
			flex-direction: column;
			align-items: center;
			padding: var(--size-4-6) var(--pn-pad) 72px;
			text-align: center;
		}

		/* Centered, yet scrollable from its top when the view is short. */
		.pn-empty > :first-child {
			margin-top: auto;
		}

		.pn-empty > :last-child {
			margin-bottom: auto;
		}

		.pn-empty-mark {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 56px;
			height: 56px;
			margin-bottom: var(--size-4-4);
			border-radius: 16px;
			background: hsla(var(--interactive-accent-hsl), 0.14);
			color: var(--text-accent);
			--icon-size: 28px;
			--icon-stroke: 1.75px;
		}

		.pn-empty h1 {
			margin: 0 0 var(--size-4-4);
			font-size: var(--font-ui-large);
			font-weight: var(--font-semibold);
			letter-spacing: -0.01em;
		}

		.pn-empty .pn-search {
			flex: none;
			width: 100%;
			max-width: 360px;
		}

		.pn-empty .pn-input {
			height: 36px;
			padding-left: 32px;
		}

		.pn-empty .pn-search-icon {
			left: 10px;
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

		/* Obsidian's buttons keep their text on one line; these wrap their titles. */
		.pn-result,
		.pn-ep-main,
		.pn-gridcard {
			white-space: normal;
		}

		.pn-result,
		.pn-ep-main {
			display: flex;
			gap: var(--size-4-3);
			height: auto;
			border: 0;
			border-radius: var(--radius-s);
			background: none;
			box-shadow: none;
			color: var(--text-normal);
			font-size: var(--font-ui-small);
			text-align: left;
			cursor: var(--cursor);
		}

		.pn-result {
			align-items: center;
			width: 100%;
			padding: var(--size-4-2);
		}

		.pn-result:hover {
			background: var(--background-modifier-hover);
		}

		.pn-result .pn-cover {
			width: 44px;
		}

		.pn-result .txt {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.pn-result .t,
		.pn-ep-title {
			font-weight: var(--font-medium);
			line-height: 1.35;
		}

		/* Long titles take two lines and break anywhere, never under a button beside them. */
		.pn-result .t,
		.pn-ep-title,
		.pn-hero h1 {
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
			overflow-wrap: anywhere;
		}

		.pn-result .s {
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.pn-result .end {
			flex: none;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 28px;
			height: 28px;
			color: var(--text-muted);
			--icon-size: 18px;
		}

		.pn-result .end.added {
			color: var(--text-success);
		}

		.pn-result:hover .end:not(.added) {
			color: var(--text-accent);
		}

		.pn-linkchip {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			vertical-align: bottom;
			--icon-size: 12px;
		}

		.pn-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
			gap: var(--size-4-2);
		}

		.pn-gridcard {
			position: relative;
			display: block;
			width: 100%;
			height: auto;
			padding: 0;
			border: 0;
			border-radius: 8px;
			background: none;
			box-shadow: none;
			cursor: var(--cursor);
			transition: transform 120ms ease;
		}

		.pn-gridcard .pn-cover {
			border-radius: 8px;
		}

		.pn-gridcard:hover .pn-cover {
			box-shadow: var(--shadow-s);
		}

		.pn-gridcard:active {
			transform: scale(0.98);
		}

		.pn-badge {
			position: absolute;
			left: 6%;
			top: 6%;
			display: flex;
			align-items: center;
			justify-content: center;
			width: 20px;
			height: 20px;
			border-radius: 50%;
			background: var(--background-primary);
			color: var(--text-error);
			box-shadow: var(--shadow-s);
			--icon-size: 12px;
			--icon-stroke: 2.25px;
		}

		.pn-iconbtn[aria-pressed="true"] {
			color: var(--icon-color-active);
			opacity: 1;
		}

		.pn-filter {
			position: sticky;
			top: 0;
			z-index: 2;
			display: flex;
			align-items: center;
			gap: var(--size-2-2);
			padding: var(--size-4-2) 0;
			margin-bottom: var(--size-2-2);
			background: var(--pn-bg);
		}

		.pn-list {
			display: flex;
			flex-direction: column;
			margin: 0 calc(-1 * var(--size-4-2));
		}

		.pn-ep {
			display: flex;
			align-items: flex-start;
			border-radius: var(--radius-s);
		}

		.pn-ep:hover {
			background: var(--background-modifier-hover);
		}

		.pn-ep-main {
			flex: 1;
			min-width: 0;
			align-items: flex-start;
			padding: var(--size-4-2) 0 var(--size-4-2) var(--size-4-2);
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

		/* In the sidebar and on a phone, the source takes its own line, so nothing truncates. */
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

		.pn-filetile {
			display: flex;
			align-items: center;
			justify-content: center;
			background: var(--background-modifier-border);
			color: var(--text-muted);
			--icon-size: 18px;
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

		.pn-ep.is-played .pn-ep-title {
			color: var(--text-muted);
			font-weight: var(--font-normal);
		}

		.pn-ep.is-current .pn-ep-title,
		.pn-ep.is-current .pn-ep-meta {
			color: var(--text-accent);
		}

		.pn-ep.is-unavailable .pn-ep-main {
			opacity: 0.45;
			cursor: default;
		}

		.pn-ep-more {
			margin: var(--size-4-2) var(--size-2-2) 0 0;
			opacity: 0.55;
		}

		.pn-ep:hover .pn-ep-more,
		.pn-ep-more:focus-visible {
			opacity: 1;
		}

		.pn-queue .pn-ep {
			align-items: center;
			gap: var(--size-2-2);
		}

		.pn-queue .pn-ep-main {
			align-items: center;
			padding-left: 0;
		}

		.pn-queue .pn-ep-main .pn-cover {
			margin-top: 0;
		}

		.pn-grip {
			cursor: grab;
			touch-action: none;
			color: var(--text-muted);
			opacity: 1;
			--icon-size: 16px;
		}

		.pn-ep:has(.pn-grip.is-dragging) {
			position: relative;
			z-index: 2;
			background: var(--pn-surface);
			box-shadow: var(--shadow-s);
		}

		.pn-ep-x {
			margin-right: var(--size-2-2);
			opacity: 0.55;
		}

		.pn-ep:hover .pn-ep-x,
		.pn-ep-x:focus-visible {
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

		.pn-hero {
			display: flex;
			align-items: center;
			gap: var(--size-4-3);
			margin: var(--size-2-2) 0 var(--size-4-2);
		}

		.pn-hero .pn-cover {
			width: 64px;
			border-radius: 8px;
		}

		.pn-hero > div {
			min-width: 0;
		}

		.pn-hero h1 {
			margin: 0;
			font-size: var(--font-ui-medium);
			font-weight: var(--font-semibold);
			line-height: 1.3;
		}

		.pn-hero .by {
			margin-top: 2px;
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.pn-banner {
			display: flex;
			align-items: flex-start;
			gap: var(--size-4-2);
			margin: var(--size-4-2) 0;
			padding: var(--size-4-2) var(--size-4-2) var(--size-4-2) var(--size-4-3);
			border: 1px solid rgba(var(--color-red-rgb), 0.25);
			border-radius: var(--radius-m);
			background: rgba(var(--color-red-rgb), 0.08);
		}

		.pn-banner-icon {
			display: flex;
			margin-top: 6px;
			color: var(--text-error);
			--icon-size: var(--icon-s);
		}

		.pn-banner .txt {
			flex: 1;
			min-width: 0;
			padding-top: 5px;
		}

		.pn-banner .h {
			font-weight: var(--font-semibold);
		}

		.pn-banner .d {
			margin-top: 2px;
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-family: var(--font-monospace);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.pn-plrow {
			display: flex;
			align-items: center;
			gap: var(--size-4-3);
			width: 100%;
			height: auto;
			padding: var(--size-4-2);
			border: 0;
			border-radius: var(--radius-s);
			background: none;
			box-shadow: none;
			color: var(--text-normal);
			font-size: var(--font-ui-small);
			font-weight: inherit;
			text-align: left;
			cursor: var(--cursor);
		}

		.pn-plrow:hover {
			background: var(--background-modifier-hover);
		}

		.pn-plicon {
			display: flex;
			align-items: center;
			justify-content: center;
			flex: none;
			width: 44px;
			height: 44px;
			border-radius: 8px;
			background: var(--background-modifier-border);
			color: var(--text-muted);
			--icon-size: 20px;
		}

		.pn-plicon.is-fav {
			background: rgba(var(--color-pink-rgb), 0.16);
			color: var(--color-pink);
		}

		.pn-plrow .txt {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.pn-plrow .t {
			font-weight: var(--font-medium);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.pn-plrow .s {
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
		}

		.pn-plchevron {
			display: flex;
			color: var(--text-muted);
			--icon-size: 16px;
		}

		.pn-plrow.is-new .pn-plicon {
			background: none;
			border: 1px dashed var(--background-modifier-border-hover);
		}

		.pn-plrow.is-new .t {
			color: var(--text-muted);
			font-weight: var(--font-normal);
		}

		.pn-iconbtn:focus-visible,
		.pn-btn:focus-visible,
		.pn-ep-main:focus-visible,
		.pn-gridcard:focus-visible,
		.pn-navitem:focus-visible,
		.pn-plrow:focus-visible,
		.pn-back:focus-visible,
		.pn-alt:focus-visible,
		.pn-result:focus-visible,
		.pn-railsearch:focus-visible,
		.pn-mini-open:focus-visible {
			outline: 2px solid var(--interactive-accent);
			outline-offset: 1px;
			box-shadow: none;
		}
	}

	@keyframes pn-eq {
		0%,
		100% {
			transform: scaleY(0.4);
		}
		50% {
			transform: scaleY(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.podcast-view :global(.pn-eq i) {
			animation: none;
		}
	}

	.is-wide :global {
		/* The pane keeps a row's metadata on one line; the source gives way. */
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

		.pn-grid {
			grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
			gap: var(--size-4-4);
		}

		.pn-hero {
			gap: var(--size-4-5);
			margin: var(--size-4-2) 0 var(--size-4-3);
		}

		.pn-hero .pn-cover {
			width: 112px;
			border-radius: 10px;
		}

		.pn-hero h1 {
			font-size: var(--font-ui-large);
			line-height: 1.25;
			letter-spacing: -0.01em;
		}

		.pn-hero .by {
			margin-top: var(--size-4-1);
			font-size: var(--font-ui-small);
		}
	}

	.is-phone :global {
		.pn-grid {
			grid-template-columns: repeat(3, 1fr);
			gap: var(--size-4-3);
		}

		.pn-navitem {
			gap: var(--size-4-3);
			padding: 0 var(--size-4-2);
		}

		.pn-navicon {
			--icon-size: 20px;
		}

		.pn-input {
			height: 44px;
			padding-left: 34px;
		}

		.pn-search-icon {
			left: 12px;
			--icon-size: 16px;
		}

		.pn-clear {
			right: 0;
			width: 44px;
			height: 44px;
		}

		.pn-empty .pn-input {
			height: 48px;
			padding-left: 36px;
		}

		.pn-result .pn-cover {
			width: 52px;
		}

		.pn-ep-main {
			padding-top: var(--size-4-3);
			padding-bottom: var(--size-4-3);
		}

		.pn-ep-main .pn-cover {
			width: 48px;
		}

		.pn-ep-more {
			margin-top: var(--size-4-1);
		}

		.pn-hero .pn-cover {
			width: 76px;
		}

		.pn-btn {
			height: 44px;
		}
	}
</style>
