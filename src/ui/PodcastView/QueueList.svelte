<script lang="ts">
	import { Scope } from "obsidian";
	import { onDestroy, tick } from "svelte";
	import { get } from "svelte/store";
	import { reorderEpisodes, type QueuePlacement } from "src/store";
	import type { Episode } from "src/types/Episode";
	import { getEpisodeKey, isSameEpisode } from "src/utility/episodeKey";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import QueueRow from "./QueueRow.svelte";

	let { empty }: { empty: string } = $props();
	const { actions, library, app } = useServices();
	const { queue } = library;

	let list: HTMLElement | undefined = $state();
	/**
	 * The drag under way, with where it would put its episode, by entry. The queue is
	 * written once, on release, so a drag across several rows saves once.
	 */
	let drag = $state.raw<{
		readonly pointerId: number;
		readonly episode: Episode;
		readonly placement?: QueuePlacement;
		stop(): void;
	}>();
	// The queue as the drop would leave it, with anything playback or the user changed since.
	const shown = $derived(
		drag?.placement ? reorderEpisodes($queue.episodes, drag.placement) : $queue.episodes,
	);

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
			if (moved.pointerType === "mouse" && moved.buttons === 0) return drop();
			place(moved.clientX, moved.clientY);
			// Moving the row's node takes focus from its grip.
			void tick().then(() => grip.focus({ preventScroll: true }));
		};
		const release = (released: PointerEvent) => {
			if (released.pointerId === pointerId) drop();
		};
		const cancel = (cancelled: PointerEvent) => {
			if (cancelled.pointerId === pointerId) end();
		};
		// Obsidian's keymap gives Escape to the newest scope and stops it there, so a
		// window listener would not hear an Escape the full player's scope takes.
		const escape = new Scope(app.scope);
		escape.register(null, "Escape", () => {
			end();
			return false;
		});
		app.keymap.pushScope(escape);
		win.addEventListener("pointermove", move);
		win.addEventListener("pointerup", release);
		win.addEventListener("pointercancel", cancel);
		drag = {
			pointerId,
			episode,
			stop() {
				win.removeEventListener("pointermove", move);
				win.removeEventListener("pointerup", release);
				win.removeEventListener("pointercancel", cancel);
				app.keymap.popScope(escape);
			},
		};
	}

	/** Ends the drag and writes nothing. */
	function end() {
		drag?.stop();
		drag = undefined;
	}

	/** Ends the drag and puts the episode where it is shown. */
	function drop() {
		const placement = drag?.placement;
		end();
		if (placement) actions.reorderQueue(placement);
	}

	/**
	 * Each row the pointer crosses puts the episode before or after that row. The row
	 * is the one hit at the point, in this list, so a pointer beside the view, over
	 * another view's Queue, or over a row the page has scrolled out of sight, places
	 * nothing. Over its own row the episode stays where it is shown, since placing it
	 * beside itself would move it back.
	 */
	function place(x: number, y: number) {
		if (!drag) return;
		const row = list?.doc.elementFromPoint(x, y)?.closest<HTMLElement>(".pn-ep");
		if (!row || !list?.contains(row)) return;
		const key = row.querySelector<HTMLElement>("[data-queue-key]")?.dataset.queueKey;
		const hovered = key && get(queue).episodes.find((entry) => getEpisodeKey(entry) === key);
		if (!hovered || isSameEpisode(hovered, drag.episode)) return;
		const { top, bottom } = row.getBoundingClientRect();
		const side = y < (top + bottom) / 2 ? "before" : "after";
		drag = { ...drag, placement: { episode: drag.episode, relativeTo: hovered, side } };
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
		{#each shown as episode, index (getEpisodeKey(episode))}
			<QueueRow
				{episode}
				{index}
				count={shown.length}
				dragging={drag !== undefined && isSameEpisode(drag.episode, episode)}
				onstart={start}
			/>
		{/each}
	</div>
{:else}
	<div class="pn-panel-empty">
		<span class="pn-panel-empty-icon" {@attach icon("list-end")}></span>
		<span>{empty}</span>
	</div>
{/if}
