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
	function details({ feed, episodes, via }: PodcastResult): string {
		const count = episodes ? `${episodes} episode${episodes === 1 ? "" : "s"}` : undefined;
		return (via ? ["", feed.author] : [feed.author, count])
			.filter((part) => part !== undefined)
			.join(" · ");
	}
</script>

{#snippet alternatives()}
	<div class="pn-alts">
		<button type="button" class="pn-alt" onclick={() => pickVaultMedia(app)}>
			<span {@attach icon("folder")}></span>Play a vault file
		</button>
		<button
			type="button"
			class="pn-alt"
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
	{#each $search.results as result (result.feed.url)}
		{@const added = actions.savedKey($savedFeeds, result.feed.url) !== undefined}
		<button
			type="button"
			class="pn-result"
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
{/if}
