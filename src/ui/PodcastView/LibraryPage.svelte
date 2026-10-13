<script lang="ts">
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import type { Layout } from "./layout";
	import { LIST_ROOTS, type RootCounts } from "./pages";
	import PodcastGrid from "./PodcastGrid.svelte";

	let { layout, counts }: { layout: Layout; counts: RootCounts } = $props();
	const { navigation, library } = useServices();
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
<PodcastGrid
	feeds={Object.entries($savedFeeds)}
	playlists={[]}
	on:clickPodcast={(event) => navigation.go({ kind: "feed", key: event.detail.key })}
/>
