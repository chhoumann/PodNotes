<script lang="ts">
	import { queue } from "src/store";
	import type { Episode } from "src/types/Episode";
	import Icon from "./obsidian/Icon.svelte";

	export let close: () => void = () => {};

	$: episodes = $queue.episodes;

	// Resolve the live index by title at click time rather than trusting the
	// index captured at render. The queue is title-unique (deduped on add), so
	// this is unambiguous, and it stays correct even if playback advances the
	// queue while the modal is open.
	function indexOf(episode: Episode): number {
		return $queue.episodes.findIndex((e) => e.title === episode.title);
	}

	function moveToTop(episode: Episode) {
		const index = indexOf(episode);
		if (index > 0) queue.moveToTop(index);
	}

	function moveUp(episode: Episode) {
		const index = indexOf(episode);
		if (index > 0) queue.moveUp(index);
	}

	function moveDown(episode: Episode) {
		const index = indexOf(episode);
		if (index !== -1 && index < $queue.episodes.length - 1) {
			queue.moveDown(index);
		}
	}

	function moveToBottom(episode: Episode) {
		const index = indexOf(episode);
		if (index !== -1 && index < $queue.episodes.length - 1) {
			queue.moveToBottom(index);
		}
	}

	function removeFromQueue(episode: Episode) {
		queue.remove(episode);
	}
</script>

<div class="queue-reorder">
	{#if episodes.length === 0}
		<p class="queue-reorder-empty">Your queue is empty.</p>
	{:else}
		<ol class="queue-reorder-list">
			{#each episodes as episode, index (episode.title)}
				<li class="queue-reorder-item">
					<span class="queue-reorder-position">{index + 1}</span>
					<div class="queue-reorder-info">
						<span class="queue-reorder-title">{episode.title}</span>
						{#if episode.podcastName}
							<span class="queue-reorder-podcast">{episode.podcastName}</span>
						{/if}
					</div>
					<div class="queue-reorder-actions">
						<Icon
							icon="chevrons-up"
							label="Move to top"
							size={18}
							disabled={index === 0}
							on:click={() => moveToTop(episode)}
						/>
						<Icon
							icon="chevron-up"
							label="Move up"
							size={18}
							disabled={index === 0}
							on:click={() => moveUp(episode)}
						/>
						<Icon
							icon="chevron-down"
							label="Move down"
							size={18}
							disabled={index === episodes.length - 1}
							on:click={() => moveDown(episode)}
						/>
						<Icon
							icon="chevrons-down"
							label="Move to bottom"
							size={18}
							disabled={index === episodes.length - 1}
							on:click={() => moveToBottom(episode)}
						/>
						<Icon
							icon="x"
							label="Remove from queue"
							size={18}
							on:click={() => removeFromQueue(episode)}
						/>
					</div>
				</li>
			{/each}
		</ol>
	{/if}

	<div class="queue-reorder-footer">
		<button type="button" class="mod-cta" on:click={close}>Done</button>
	</div>
</div>

<style>
	.queue-reorder {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.queue-reorder-empty {
		text-align: center;
		color: var(--text-muted);
		padding: 1.5rem 0;
	}

	.queue-reorder-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		max-height: 60vh;
		overflow-y: auto;
	}

	.queue-reorder-item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.5rem 0.625rem;
		border: 1px solid var(--background-modifier-border);
		border-radius: 0.5rem;
		background: var(--background-secondary);
	}

	.queue-reorder-position {
		flex: 0 0 1.5rem;
		text-align: center;
		font-variant-numeric: tabular-nums;
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.queue-reorder-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		flex: 1 1 auto;
		min-width: 0;
	}

	.queue-reorder-title {
		font-size: 0.9rem;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.queue-reorder-podcast {
		font-size: 0.75rem;
		color: var(--text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.queue-reorder-actions {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		flex: 0 0 auto;
	}

	.queue-reorder-footer {
		display: flex;
		justify-content: flex-end;
	}
</style>
