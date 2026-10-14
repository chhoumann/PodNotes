<script lang="ts">
	import type { Chapter } from "src/types/Chapter";
	import { formatDuration } from "src/utility/formatDuration";
	import { chapterAt } from "./chapters";

	let {
		chapters,
		position,
		onseek,
	}: {
		chapters: readonly Chapter[];
		position: number;
		onseek(time: number): void;
	} = $props();

	let list: HTMLOListElement | undefined = $state();
	const current = $derived(chapterAt(chapters, position));

	// Scrolls only the panel: scrollIntoView would also scroll the view and an editor around it.
	$effect(() => {
		const row = list?.children[current];
		if (!list || !row) return;
		const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
		list.scrollTop += top - list.clientHeight / 3;
	});
</script>

<div class="pn-panel">
	<ol class="pn-panel-scroll" aria-label="Chapters" bind:this={list}>
		{#each chapters as chapter, index (index)}
			<li>
				<button
					type="button"
					class="pn-chap"
					class:is-now={index === current}
					aria-current={index === current || undefined}
					onclick={() => onseek(chapter.startTime)}
				>
					<span class="tm">{formatDuration(chapter.startTime)}</span>
					<span class="nm">{chapter.title}</span>
				</button>
			</li>
		{/each}
	</ol>
</div>

<style>
	ol {
		margin: 0;
		list-style: none;
	}

	.pn-panel .pn-chap {
		display: flex;
		align-items: baseline;
		justify-content: flex-start;
		gap: var(--size-4-3);
		width: 100%;
		height: auto;
		padding: 6px var(--size-4-2);
		border-radius: var(--radius-s);
		background: none;
		box-shadow: none;
		color: var(--text-muted);
		font-size: inherit;
		line-height: 1.45;
		text-align: left;
		white-space: normal;
	}

	.pn-panel .pn-chap:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.pn-panel .pn-chap.is-now {
		background: hsla(var(--interactive-accent-hsl), 0.12);
		color: var(--text-normal);
	}

	.tm {
		flex: none;
		width: 44px;
		font-size: var(--font-ui-smaller);
		font-variant-numeric: tabular-nums;
	}

	.is-now .tm {
		color: var(--text-accent);
	}

	.nm {
		font-weight: var(--font-medium);
	}

	:global(.is-phone) .pn-panel .pn-chap {
		min-height: 44px;
		padding: 10px var(--size-4-2);
	}
</style>
