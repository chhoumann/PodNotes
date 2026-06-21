<script lang="ts">
	import type { Playlist } from "src/types/Playlist";
	import { createEventDispatcher } from "svelte";
	import Icon from "../obsidian/Icon.svelte";

	export let playlist: Playlist;

	const dispatch = createEventDispatcher();

	function onClickPlaylist(event: MouseEvent) {
		dispatch("clickPlaylist", { playlist, event });
	}

</script>

<button
	type="button"
	class="playlist-card"
	aria-label={playlist.name}
	title={playlist.name}
	on:click={onClickPlaylist}
>
	<Icon icon={playlist.icon} size={32} clickable={false}/>
	<span class="playlist-card-name">{playlist.name}</span>
	<span class="playlist-card-count">
		({playlist.episodes.length})
	</span>
</button>

<style>
	.playlist-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		width: 100%;
		min-height: 5rem;
		padding: 0.75rem 0.5rem;
		/* `min-height` is a floor, not a cap: the card must grow to fit icon +
		   name + count. The grid uses min-content rows, so the row grows with it. */
		height: auto;
		border: 1px solid var(--background-modifier-border);
		border-radius: 0.5rem;
		text-align: center;
		background: var(--background-secondary);
		cursor: pointer;
		transition: transform 150ms ease, box-shadow 150ms ease, border-color 150ms ease, background-color 150ms ease;
	}

	.playlist-card:hover {
		transform: scale(1.02);
		border-color: var(--interactive-accent);
		background-color: var(--background-secondary-alt);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
	}

	.playlist-card:active {
		transform: scale(0.98);
	}

	/* Keep the icon, name, and count at their natural height so flexbox never
	   compresses/clips a label to fit the min-height (the bug where the name
	   overlapped the count). The card grows instead. */
	.playlist-card-name,
	.playlist-card-count {
		flex-shrink: 0;
	}

	.playlist-card :global(.icon-static) {
		flex-shrink: 0;
	}

	.playlist-card-name {
		max-width: 100%;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.85rem;
		line-height: 1.3;
		color: var(--text-normal);
	}

	.playlist-card-count {
		font-size: 0.8rem;
		line-height: 1.3;
		color: var(--text-muted);
	}
</style>
