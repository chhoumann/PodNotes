<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import type { Chapter } from "src/types/Chapter";
	import { formatSeconds } from "src/utility/formatSeconds";
	import Icon from "../obsidian/Icon.svelte";

	export let chapters: Chapter[] = [];
	export let currentTime: number = 0;

	const dispatch = createEventDispatcher<{ seek: { time: number } }>();

	let isExpanded = true;

	function getCurrentChapterIndex(): number {
		for (let i = chapters.length - 1; i >= 0; i--) {
			if (currentTime >= chapters[i].startTime) {
				return i;
			}
		}
		return -1;
	}

	function handleChapterClick(chapter: Chapter) {
		dispatch("seek", { time: chapter.startTime });
	}

	$: currentChapterIndex = getCurrentChapterIndex();
</script>

{#if chapters.length > 0}
	<div class="chapter-list">
		<button
			type="button"
			class="chapter-header"
			on:click={() => (isExpanded = !isExpanded)}
			aria-expanded={isExpanded}
		>
			<Icon icon={isExpanded ? "chevron-down" : "chevron-right"} size={16} />
			<h3>Chapters ({chapters.length})</h3>
		</button>

		{#if isExpanded}
			<ul class="chapters">
				{#each chapters as chapter, index}
					<li class:active={index === currentChapterIndex}>
						<button
							type="button"
							class="chapter-item"
							on:click={() => handleChapterClick(chapter)}
						>
							<span class="chapter-time">{formatSeconds(chapter.startTime, "H:mm:ss")}</span>
							<span class="chapter-title">{chapter.title}</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}

<style>
	.chapter-list {
		margin: 1rem 0;
	}

	.chapter-header {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		background: none;
		border: none;
		padding: 0.25rem 0;
		cursor: pointer;
		width: 100%;
		text-align: left;
		color: var(--text-normal);
	}

	.chapter-header:hover {
		color: var(--text-accent);
	}

	.chapter-header h3 {
		margin: 0;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.chapters {
		list-style: none;
		padding: 0;
		margin: 0.5rem 0 0 0;
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.chapters li {
		border-radius: 0.375rem;
	}

	.chapters li.active {
		background: var(--background-modifier-hover);
	}

	.chapter-item {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		padding: 0.5rem 0.625rem;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: var(--text-normal);
		border-radius: 0.375rem;
		transition: background 100ms ease;
	}

	.chapter-item:hover {
		background: var(--background-modifier-hover);
	}

	.chapter-time {
		font-size: 0.75rem;
		font-family: var(--font-monospace);
		color: var(--text-muted);
		min-width: 4rem;
	}

	.chapter-title {
		font-size: 0.875rem;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.chapters li.active .chapter-title {
		font-weight: 500;
		color: var(--text-accent);
	}
</style>
