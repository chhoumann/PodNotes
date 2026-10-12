<script lang="ts">
	import { icon } from "../obsidian/icon";
	import PodcastQueryGrid from "../settings/PodcastQueryGrid.svelte";

	let { firstRun }: { firstRun: boolean } = $props();
</script>

{#if firstRun}
	<!-- Top-aligned: the results list under the field, which must not move while the user types. -->
	<div class="pn-first-col">
		<div class="pn-empty">
			<span class="pn-empty-mark" {@attach icon("podcast")}></span>
			<h1>Add your first podcast</h1>
		</div>
		<PodcastQueryGrid />
	</div>
{:else}
	<PodcastQueryGrid />
{/if}

<style>
	.pn-first-col {
		max-width: 360px;
		margin: 0 auto;
	}

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
