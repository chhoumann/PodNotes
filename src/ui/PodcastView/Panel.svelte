<script lang="ts">
	import type { Snippet } from "svelte";

	/** A player panel: an optional head line over a list that scrolls under faded edges. */
	let {
		head,
		list,
		scroller = $bindable(),
		children,
	}: {
		head?: Snippet;
		/** Names the scroller as an ordered list, whose items the children are. */
		list?: string;
		scroller?: HTMLElement;
		children: Snippet;
	} = $props();
</script>

<div class="pn-panel">
	{#if head}
		<div class="pn-panel-head">{@render head()}</div>
	{/if}
	{#if list}
		<ol class="pn-panel-scroll" aria-label={list} bind:this={scroller}>{@render children()}</ol>
	{:else}
		<div class="pn-panel-scroll" bind:this={scroller}>{@render children()}</div>
	{/if}
</div>

<style>
	.pn-panel {
		width: 100%;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.pn-panel :global {
		.pn-panel-head {
			flex: none;
			display: flex;
			align-items: center;
			gap: var(--size-4-2);
			min-height: 32px;
			padding-bottom: var(--size-2-2);
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-weight: var(--font-medium);
			white-space: nowrap;
		}

		.pn-panel-scroll {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
			overflow-y: auto;
			padding: var(--size-4-2) 0 var(--size-4-4);
			mask-image: linear-gradient(
				to bottom,
				transparent,
				#000 12px,
				#000 calc(100% - 20px),
				transparent
			);
		}

		ol {
			margin: 0;
			list-style: none;
		}

		.pn-panel-scroll > .pn-panel-empty {
			margin: auto 0;
		}
	}

	:global(.is-wide) .pn-panel :global {
		.pn-panel-scroll {
			padding: var(--size-4-3) var(--size-4-4) var(--size-4-4);
		}

		.pn-panel-head {
			padding: var(--size-4-2) var(--size-4-4) 0 var(--size-4-6);
		}
	}

	:global(.is-phone) .pn-panel :global(.pn-panel-head) {
		min-height: 44px;
	}
</style>
