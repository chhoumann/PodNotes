<script lang="ts">
	import { tick } from "svelte";
	import { get } from "svelte/store";
	import type { Episode } from "src/types/Episode";
	import { getEpisodeKey, isSameEpisode } from "src/utility/episodeKey";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import EpisodeRow from "./EpisodeRow.svelte";
	import { episodeMenu, openEpisode, showMenu } from "./menus";

	let {
		episode,
		index,
		count,
		dragging,
		onstart,
	}: {
		episode: Episode;
		index: number;
		count: number;
		dragging: boolean;
		/** A press on the grip that may start a drag. */
		onstart(event: PointerEvent, episode: Episode): void;
	} = $props();
	const services = useServices();
	const { actions, library } = services;

	/** Up and Down move the episode past its neighbour in the queue as it is now. */
	async function nudge(event: KeyboardEvent) {
		const side =
			event.key === "ArrowUp" ? "before" : event.key === "ArrowDown" ? "after" : undefined;
		if (!side) return;
		event.preventDefault();
		const grip = event.currentTarget as HTMLElement;
		const queued = get(library.queue).episodes;
		const at = queued.findIndex((entry) => isSameEpisode(entry, episode));
		const neighbour = at < 0 ? undefined : queued[side === "before" ? at - 1 : at + 1];
		if (!neighbour) return;
		actions.reorderQueue({ episode, relativeTo: neighbour, side });
		// Moving the row's node takes focus from it.
		await tick();
		grip.focus({ preventScroll: true });
	}
</script>

<EpisodeRow
	{episode}
	cover
	onplay={() => openEpisode(services, episode)}
	onmenu={(at) => showMenu(episodeMenu(episode, services, { place: "list", at }), at)}
>
	{#snippet leading()}
		<button
			type="button"
			class="pn-iconbtn pn-grip"
			class:is-dragging={dragging}
			data-queue-key={getEpisodeKey(episode)}
			aria-label="Reorder {episode.title}, position {index +
				1} of {count}. Use arrow keys to move."
			title="Drag or use arrow keys"
			onpointerdown={(event) => onstart(event, episode)}
			onkeydown={nudge}
			{@attach icon("grip-vertical")}
		></button>
	{/snippet}
	{#snippet trailing()}
		<button
			type="button"
			class="pn-iconbtn pn-ep-x"
			aria-label="Remove {episode.title} from queue"
			title="Remove from queue"
			onclick={() => actions.setQueued(episode, false)}
			{@attach icon("x")}
		></button>
	{/snippet}
</EpisodeRow>
