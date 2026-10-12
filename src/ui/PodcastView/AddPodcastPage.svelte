<script lang="ts">
	import { icon } from "../obsidian/icon";
	import PodcastQueryGrid from "../settings/PodcastQueryGrid.svelte";

	let { firstRun }: { firstRun: boolean } = $props();
</script>

{#if firstRun}
	<div class="pn-empty">
		<span class="pn-empty-mark" {@attach icon("podcast")}></span>
		<h1>Add your first podcast</h1>
	</div>
{/if}
<!-- The search fades in and out with the block it is in. A block of its own keeps
     that fade local to it, so it never lingers over the page that replaces it. -->
{#if true}
	<PodcastQueryGrid />
{/if}

<style>
	.pn-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: var(--size-4-12) 0 var(--size-4-4);
		text-align: center;
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
		margin: 0;
		font-size: var(--font-ui-large);
		font-weight: var(--font-semibold);
		letter-spacing: -0.01em;
	}
</style>
