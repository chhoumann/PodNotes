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
		<!-- A touch that starts on the grip starts none of Obsidian's mobile swipes, such as the pull-down action. -->
		<button
			type="button"
			class="pn-iconbtn pn-grip"
			class:is-dragging={dragging}
			data-queue-key={getEpisodeKey(episode)}
			data-ignore-swipe="true"
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

<style>
	button.pn-iconbtn.pn-grip {
		cursor: grab;
		touch-action: none;
		color: var(--text-muted);
		opacity: 1;
		--icon-size: 16px;
	}

	button.pn-iconbtn.pn-ep-x {
		margin-right: var(--size-2-2);
		opacity: 0.55;
	}

	:global(.pn-ep:hover) button.pn-ep-x,
	button.pn-iconbtn.pn-ep-x:focus-visible {
		opacity: 1;
	}
</style>
