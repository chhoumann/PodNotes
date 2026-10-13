<script lang="ts">
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import { shownFailure } from "./episodeListSelection";
	import type { Layout } from "./layout";
	import { anchorOf, podcastMenu, showMenu } from "./menus";
	import { LIST_ROOTS, type RootCounts } from "./pages";

	let { layout, counts }: { layout: Layout; counts: RootCounts } = $props();
	const services = useServices();
	const { navigation, feeds, library, online } = services;
	const { savedFeeds } = library;
	const id = $props.id();
</script>

{#if layout === "compact"}
	<nav class="pn-nav" aria-labelledby="{id}-name">
		<span id="{id}-name" hidden>Lists</span>
		{#each LIST_ROOTS as root (root.kind)}
			<button
				type="button"
				class="pn-navitem"
				onclick={() => navigation.go({ kind: root.kind })}
			>
				<span class="pn-navicon" {@attach icon(root.icon)}></span>
				<span class="lbl">{root.label}</span>
				{#if counts[root.kind]}<span class="flair">{counts[root.kind]}</span>{/if}
			</button>
		{/each}
	</nav>
	<h2 class="pn-h2">Podcasts</h2>
{/if}
<div class="pn-grid">
	{#each Object.entries($savedFeeds) as [key, feed] (key)}
		{@const feedState = $feeds.get(key)}
		{@const failed = feedState !== undefined && shownFailure(feedState, $online) !== undefined}
		<button
			type="button"
			class="pn-gridcard"
			aria-label={failed ? `${feed.title}, feed didn't load` : feed.title}
			title={feed.title}
			onclick={() => navigation.go({ kind: "feed", key })}
			oncontextmenu={(event) => showMenu(podcastMenu(key, services), anchorOf(event))}
		>
			<Cover src={feed.artworkUrl} title={feed.title} />
			{#if failed}<span class="pn-badge" {@attach icon("alert-triangle")}></span>{/if}
		</button>
	{/each}
</div>
