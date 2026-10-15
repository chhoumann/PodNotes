<script lang="ts">
	import { onMount } from "svelte";
	import { importOPML } from "src/opml";
	import { icon } from "../obsidian/icon";
	import { pickFile } from "../pickFile";
	import { pickVaultMedia } from "../pickVaultMedia";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import type { PodcastResult, SearchFailure } from "./podcastSearch";
	import SearchField from "./SearchField.svelte";

	let { firstRun }: { firstRun: boolean } = $props();
	const { app, navigation, library, actions, search } = useServices();
	const { savedFeeds } = library;

	// Back from Add podcast starts First run over, with no query and no search left to answer.
	onMount(() => {
		if (firstRun) search.set("");
	});

	const FAILED: Record<SearchFailure, string> = {
		offline: "Search needs a connection",
		"no-feed": "This show has no public feed",
		feed: "Feed didn't load",
		search: "Search didn't load",
	};

	function add(result: PodcastResult) {
		const key = actions.addPodcast(result.feed);
		if (key !== null) navigation.go({ kind: "feed", key });
	}

	/** What follows the link chip: the author, and the episode count of a show search found. */
	function details({ feed, episodeCount, via }: PodcastResult): string {
		const count = episodeCount
			? `${episodeCount} episode${episodeCount === 1 ? "" : "s"}`
			: undefined;
		return (via ? ["", feed.author] : [feed.author, count])
			.filter((part) => part !== undefined)
			.join(" · ");
	}
</script>

{#snippet alternatives()}
	<div class="pn-alts">
		<button type="button" class="pn-bare pn-alt" onclick={() => pickVaultMedia(app)}>
			<span {@attach icon("folder")}></span>Play a vault file
		</button>
		<button
			type="button"
			class="pn-bare pn-alt"
			onclick={() =>
				pickFile(".opml", importOPML, {
					tooLargeMessage: "That file is too large to be an OPML file.",
				})}
		>
			<span {@attach icon("upload")}></span>Import OPML
		</button>
	</div>
{/snippet}

{#if firstRun}
	<div class="pn-empty">
		<span class="pn-empty-mark" {@attach icon("podcast")}></span>
		<h1>Add your first podcast</h1>
		<SearchField
			value={$search.query}
			placeholder="Search or paste a link"
			autofocus
			large
			oninput={(value) => {
				search.set(value);
				if (value.trim()) navigation.go({ kind: "add" });
			}}
		/>
		{@render alternatives()}
	</div>
{:else if $search.status === "idle"}
	{@render alternatives()}
{:else if $search.status === "searching"}
	<div class="pn-count" role="status">Searching</div>
{:else if $search.status === "failed"}
	<div class="pn-panel-empty" role="alert">{FAILED[$search.failure]}</div>
{:else if $search.results.length === 0}
	<div class="pn-panel-empty" role="status">No shows match</div>
{:else}
	<div class="pn-count" role="status">
		{$search.results.length}
		{$search.results.length === 1 ? "show" : "shows"}
	</div>
	<div class="pn-results">
		{#each $search.results as result (result.feed.url)}
			{@const added = actions.savedKey($savedFeeds, result.feed.url) !== undefined}
			<button
				type="button"
				class="pn-bare pn-result"
				aria-label="{added ? 'Open' : 'Add'} {result.feed.title}"
				onclick={() => add(result)}
			>
				<Cover src={result.feed.artworkUrl} title={result.feed.title} />
				<span class="txt">
					<span class="t">{result.feed.title}</span>
					<span class="s">
						{#if result.via}<span class="pn-linkchip"
								><span {@attach icon("link")}></span>{result.via}</span
							>{/if}{details(result)}
					</span>
				</span>
				<span class="end" class:added {@attach icon(added ? "check" : "plus")}></span>
			</button>
		{/each}
	</div>
{/if}

<style>
	.pn-empty :global {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: var(--size-4-6) var(--pn-pad) 72px;
		text-align: center;

		/* Centered, yet scrollable from its top when the view is short. */
		> :first-child {
			margin-top: auto;
		}

		> :last-child {
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

		h1 {
			margin: 0 0 var(--size-4-4);
			font-size: var(--font-ui-large);
			font-weight: var(--font-semibold);
			letter-spacing: -0.01em;
		}

		.pn-alts {
			align-items: center;
			margin-top: var(--size-4-4);
		}
	}

	.pn-alts :global {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--size-2-2);
		margin-top: var(--size-4-2);

		.pn-alt {
			gap: var(--size-4-2);
			height: var(--pn-btn);
			padding: 0 var(--size-4-2);
			border-radius: var(--radius-s);
			color: var(--text-muted);
		}

		@media (hover: hover) {
			.pn-alt:hover {
				background: var(--background-modifier-hover);
				color: var(--text-normal);
			}
		}

		.pn-alt > span {
			display: flex;
			--icon-size: var(--icon-s);
			--icon-stroke: var(--icon-s-stroke-width);
		}
	}

	.pn-results :global {
		/* Obsidian's buttons keep their text on one line; this one wraps its title. */
		.pn-result {
			display: flex;
			gap: var(--size-4-3);
			width: 100%;
			height: auto;
			padding: var(--size-4-2);
			border-radius: var(--radius-s);
			color: var(--text-normal);
			text-align: left;
			white-space: normal;
		}

		@media (hover: hover) {
			.pn-result:hover {
				background: var(--background-modifier-hover);
			}

			.pn-result:hover .end:not(.added) {
				color: var(--text-accent);
			}
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

		/* A long title takes two lines and breaks anywhere, never under the mark beside it. */
		.pn-result .t {
			font-weight: var(--font-medium);
			line-height: 1.35;
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

		.pn-linkchip {
			display: inline-flex;
			align-items: center;
			gap: 4px;
			vertical-align: bottom;
			--icon-size: 12px;
		}

		.is-phone & .pn-result .pn-cover {
			width: 52px;
		}
	}
</style>
