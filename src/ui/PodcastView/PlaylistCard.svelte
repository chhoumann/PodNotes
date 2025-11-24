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
	on:click={onClickPlaylist}
>
	<Icon icon={playlist.icon} size={40} clickable={false}/>
	<span>
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

	.playlist-card span {
		font-size: 0.8rem;
		color: var(--text-muted);
	}
</style>
