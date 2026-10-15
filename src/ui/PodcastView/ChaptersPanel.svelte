<script lang="ts">
	import type { Chapter } from "src/types/Chapter";
	import { formatDuration } from "src/utility/formatDuration";
	import { chapterAt } from "./chapters";
	import Panel, { reveal } from "./Panel.svelte";

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

	$effect(() => {
		if (list) reveal(list, current);
	});
</script>

<Panel list="Chapters" bind:scroller={list}>
	{#each chapters as chapter, index (index)}
		<li>
			<button
				type="button"
				class="pn-bare pn-row"
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
