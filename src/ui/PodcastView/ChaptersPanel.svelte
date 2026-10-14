<script lang="ts">
	import type { Chapter } from "src/types/Chapter";
	import { formatDuration } from "src/utility/formatDuration";
	import { chapterAt } from "./chapters";
	import Panel from "./Panel.svelte";

	let {
		chapters,
		position,
		onseek,
	}: {
		chapters: readonly Chapter[];
		position: number;
		onseek(time: number): void;
	} = $props();

	let list: HTMLElement | undefined = $state();
	const current = $derived(chapterAt(chapters, position));

	// Scrolls only the panel: scrollIntoView would also scroll the view and an editor around it.
	$effect(() => {
		const row = list?.children[current];
		if (!list || !row) return;
		const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
		list.scrollTop += top - list.clientHeight / 3;
	});
</script>

<Panel list="Chapters" bind:scroller={list}>
	{#each chapters as chapter, index (index)}
		<li>
			<button
				type="button"
				class="pn-row pn-chap"
				class:is-now={index === current}
				aria-current={index === current || undefined}
				onclick={() => onseek(chapter.startTime)}
			>
				<span class="tm">{formatDuration(chapter.startTime)}</span>
				<span class="nm">{chapter.title}</span>
			</button>
		</li>
	{/each}
</Panel>

<style>
	.pn-chap :global(.nm) {
		font-weight: var(--font-medium);
	}
</style>
