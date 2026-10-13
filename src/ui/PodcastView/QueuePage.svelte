<script lang="ts">
	import { onDestroy, tick } from "svelte";
	import { get } from "svelte/store";
	import type { Episode } from "src/types/Episode";
	import { getEpisodeKey, isSameEpisode } from "src/utility/episodeKey";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import QueueRow from "./QueueRow.svelte";

	const { actions, library } = useServices();
	const { queue } = library;

	let list: HTMLElement | undefined = $state();
	/** The drag under way. The queue store keeps the order; a drag only names its episode. */
	let drag = $state.raw<{
		readonly pointerId: number;
		readonly episode: Episode;
		stop(): void;
	}>();

	/**
	 * Listens on the grip's own window, which is a popout's when the view is in one,
	 * until the button is released. Pointer capture is not used, because the keyed rows
	 * move the grip's node and a moved node can lose it.
	 */
	function start(event: PointerEvent, episode: Episode) {
		if (event.button !== 0 || drag) return;
		const grip = event.currentTarget as HTMLElement;
		event.preventDefault();
		grip.focus();
		const { pointerId } = event;
		const win = grip.win;
		const move = (moved: PointerEvent) => {
			if (moved.pointerId !== pointerId) return;
			// A button released outside the window sent no pointerup here.
			if (moved.pointerType === "mouse" && moved.buttons === 0) return end();
			place(episode, moved.clientX, moved.clientY);
			// Moving the row's node takes focus from its grip.
			void tick().then(() => grip.focus({ preventScroll: true }));
		};
		const release = (released: PointerEvent) => {
			if (released.pointerId === pointerId) end();
		};
		const escape = (key: KeyboardEvent) => {
			if (key.key === "Escape") end();
		};
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", release);
		win.addEventListener("pointercancel", release);
		win.addEventListener("keydown", escape);
		drag = {
			pointerId,
			episode,
			stop() {
				win.removeEventListener("pointermove", move);
				win.removeEventListener("pointerup", release);
				win.removeEventListener("pointercancel", release);
				win.removeEventListener("keydown", escape);
			},
		};
	}

	function end() {
		drag?.stop();
		drag = undefined;
	}

	/**
	 * Each row the pointer crosses places the episode before or after that row, in the
	 * store. The row is the one hit at the point, in this list, so a pointer beside the
	 * view, over another view's Queue, or over a row the page has scrolled out of sight,
	 * places nothing.
	 */
	function place(episode: Episode, x: number, y: number) {
		const row = list?.doc.elementFromPoint(x, y)?.closest<HTMLElement>(".pn-ep");
		if (!row || !list?.contains(row)) return;
		const key = row.querySelector<HTMLElement>("[data-queue-key]")?.dataset.queueKey;
		const hovered = key && get(queue).episodes.find((entry) => getEpisodeKey(entry) === key);
		if (!hovered) return;
		const { top, bottom } = row.getBoundingClientRect();
		const side = y < (top + bottom) / 2 ? "before" : "after";
		actions.reorderQueue({ episode, relativeTo: hovered, side });
	}

	// Playback can take the dragged episode out of the queue mid-drag.
	$effect(() => {
		const dragged = drag?.episode;
		if (dragged && !$queue.episodes.some((entry) => isSameEpisode(entry, dragged))) end();
	});
	onDestroy(end);
</script>

{#if $queue.episodes.length > 0}
	<div class="pn-list pn-queue" role="list" aria-label="Queue" bind:this={list}>
		{#each $queue.episodes as episode, index (getEpisodeKey(episode))}
			<QueueRow
				{episode}
				{index}
				count={$queue.episodes.length}
				dragging={drag !== undefined && isSameEpisode(drag.episode, episode)}
				onstart={start}
			/>
		{/each}
	</div>
{:else}
	<div class="pn-panel-empty">
		<span class="pn-panel-empty-icon" {@attach icon("list-end")}></span>
		<span>Nothing here yet</span>
	</div>
{/if}
