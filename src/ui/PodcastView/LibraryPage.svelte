<script lang="ts">
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import { shownFailure } from "./feedState";
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

<style>
	.pn-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
		gap: var(--size-4-2);
	}

	.pn-grid :global {
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
			white-space: normal;
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
	}

	:global(.is-wide) .pn-grid {
		grid-template-columns: repeat(auto-fill, minmax(108px, 1fr));
		gap: var(--size-4-4);
	}

	:global(.is-phone) .pn-grid {
		grid-template-columns: repeat(3, 1fr);
		gap: var(--size-4-3);
	}
</style>
