<script module lang="ts">
	/**
	 * Scrolls `list` to show its row at index `at` under as many whole rows as fit in the top
	 * third, starting where the faded top edge ends, so no row shows cut there, and under the
	 * whole row before it even when that one does not fit. The row never reaches into the faded
	 * bottom edge, and never starts under the faded top edge. Not scrollIntoView, which would
	 * also scroll the view and an editor around it.
	 */
	export function reveal(list: HTMLElement, at: number) {
		const row = list.children[at];
		if (!row) return;
		const style = list.win.getComputedStyle(list);
		// The band between the faded edges, from the list's top.
		const top = parseFloat(style.scrollPaddingTop);
		const bottom = list.clientHeight - parseFloat(style.scrollPaddingBottom);
		const box = row.getBoundingClientRect();
		// Whole rows above it, from where the top fade ends, as long as they fit in the top third.
		const third = list.clientHeight / 3;
		let y = top;
		for (let above = row.previousElementSibling; above; above = above.previousElementSibling) {
			const start = top + box.top - above.getBoundingClientRect().top;
			if (y > top && start > third) break;
			y = start;
		}
		y = Math.max(top, Math.min(y, bottom - box.height));
		list.scrollTop += box.top - list.getBoundingClientRect().top - y;
	}
</script>

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
	const id = $props.id();
</script>

<div class="pn-panel">
	{#if head}
		<div class="pn-panel-head">{@render head()}</div>
	{/if}
	{#if list}
		<!-- Obsidian shows an aria-label as a tooltip over the whole list. -->
		<span id="{id}-list" hidden>{list}</span>
		<ol class="pn-panel-scroll" aria-labelledby="{id}-list" bind:this={scroller}>
			{@render children()}
		</ol>
	{:else}
		<div class="pn-panel-scroll" bind:this={scroller}>{@render children()}</div>
	{/if}
</div>

<style>
	.pn-panel :global {
		width: 100%;
		height: 100%;
		min-height: 0;
		display: flex;
		flex-direction: column;

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
			--pn-fade-top: 12px;
			--pn-fade-bottom: 20px;
			/* A line in a faded edge is not in view. */
			scroll-padding: var(--pn-fade-top) 0 var(--pn-fade-bottom);
			mask-image: linear-gradient(
				transparent,
				#000 var(--pn-fade-top) calc(100% - var(--pn-fade-bottom)),
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

		.pn-row {
			display: flex;
			align-items: baseline;
			justify-content: flex-start;
			gap: var(--size-4-3);
			width: 100%;
			height: auto;
			padding: 6px var(--size-4-2);
			border-radius: var(--radius-s);
			color: var(--text-muted);
			font-size: inherit;
			line-height: 1.45;
			text-align: left;
			white-space: normal;
		}

		@media (hover: hover) {
			button.pn-row:not(.is-now):hover {
				background: var(--background-modifier-hover);
				color: var(--text-normal);
			}
		}

		.pn-row.is-now {
			background: hsla(var(--interactive-accent-hsl), 0.12);
			color: var(--text-normal);
		}

		.pn-row .tm {
			flex: none;
			width: 44px;
			font-size: var(--font-ui-smaller);
			font-variant-numeric: tabular-nums;
		}

		.pn-row.is-now .tm {
			color: var(--text-accent);
		}

		.pn-row .nm {
			font-weight: var(--font-medium);
		}

		.is-wide & {
			.pn-panel-scroll {
				padding: var(--size-4-3) var(--size-4-4) var(--size-4-4);
			}

			.pn-panel-head {
				padding: var(--size-4-2) var(--size-4-4) 0 var(--size-4-6);
			}
		}

		.is-phone & {
			.pn-panel-head,
			.pn-panel-head :is(button, input) {
				min-width: 44px;
				min-height: 44px;
			}

			.pn-row {
				min-height: 44px;
				padding: 10px var(--size-4-2);
			}
		}
	}
</style>
