<script lang="ts">
	import type { Playlist } from "src/types/Playlist";
	import { createEventDispatcher } from "svelte";
	import Icon from "../obsidian/Icon.svelte";

	export let playlist: Playlist;
	export let showDeleteButton: boolean = true;

	let clickedDelete: boolean = false;
	const dispatch = createEventDispatcher();

	function onClickedDelete(event: CustomEvent) {
		if (clickedDelete) {
			dispatch("delete", { value: playlist });
			return;
		}

		clickedDelete = true;

		setTimeout(() => {
			clickedDelete = false;
		}, 2000);
	}

	function onClickedRepeat(event: CustomEvent) {
		dispatch("toggleRepeat", { value: playlist });
	}
</script>

<div class="playlist-item">
	<div class="playlist-item-left">
		<Icon
			icon={playlist.icon}
			style={{ "margin-right": "0.2rem" }}
			clickable={false}
			size={20}
		/>
		<span style="font-weight: 500; margin-right: 0.2rem;"
			>{playlist.name}</span
		>
		({playlist.episodes.length})
	</div>

	<div class="playlist-item-controls">
<!-- Still considering this feature.
	 		<Icon
			icon="repeat"
			label="Repeat after play"
			size={20}
			style={{ color: playlist.shouldRepeat ? "green" : "" }}
			on:click={onClickedRepeat}
		/> -->
		{#if showDeleteButton}
			<Icon
				icon={clickedDelete ? "check" : "trash"}
				label={clickedDelete ? "Confirm deletion" : "Delete playlist"}
				size={20}
				style={{ color: "red" }}
				on:click={onClickedDelete}
			/>
		{/if}
	</div>
</div>

<style>
	.playlist-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem;
		border-bottom: 1px solid var(--background-modifier-border);
		width: 100%;
	}

	.playlist-item-left {
		display: flex;
		align-items: center;
	}

	.playlist-item-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
</style>
