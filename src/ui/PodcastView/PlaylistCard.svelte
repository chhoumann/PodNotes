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
		width: 100%;
		height: 100%;
		border: 1px solid var(--background-modifier-border);
		text-align: center;
		overflow: hidden;
		background: transparent;
		padding: 0;
	}

	.playlist-card:hover {
		background-color: var(--background-modifier-border);
	}
</style>
