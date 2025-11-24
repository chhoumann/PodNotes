<script lang="ts">
	import type { Playlist } from "src/types/Playlist";
	import { createEventDispatcher } from "svelte";
	import Icon from "../obsidian/Icon.svelte";

	export let playlist: Playlist;
	export let showDeleteButton: boolean = true;

	let clickedDelete: boolean = false;
	const dispatch = createEventDispatcher();

	function onClickedDelete() {
		if (clickedDelete) {
			dispatch("delete", { value: playlist });
			return;
		}

		clickedDelete = true;

		setTimeout(() => {
			clickedDelete = false;
		}, 2000);
	}

	function onClickedRepeat() {
		dispatch("toggleRepeat", { value: playlist });
	}
</script>

<div class="playlist-item">
	<div class="playlist-item-left">
		<Icon
			icon={playlist.icon}
			clickable={false}
			size={18}
		/>
		<span class="playlist-name">{playlist.name}</span>
		<span class="playlist-count">({playlist.episodes.length})</span>
	</div>

	<div class="playlist-item-controls">
		{#if showDeleteButton}
			<button
				type="button"
				class="delete-button"
				class:confirm={clickedDelete}
				on:click={onClickedDelete}
				aria-label={clickedDelete ? "Confirm deletion" : "Delete playlist"}
			>
				<Icon
					icon={clickedDelete ? "check" : "trash"}
					clickable={false}
					size={16}
				/>
			</button>
		{/if}
	</div>
</div>

<style>
	.playlist-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem;
		width: 100%;
		background: var(--background-secondary);
		transition: background-color 120ms ease;
	}

	.playlist-item:not(:last-child) {
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.playlist-item:hover {
		background: var(--background-secondary-alt);
	}

	.playlist-item-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-width: 0;
	}

	.playlist-name {
		font-weight: 500;
		font-size: 0.9rem;
		color: var(--text-normal);
	}

	.playlist-count {
		font-size: 0.8rem;
		color: var(--text-muted);
	}

	.playlist-item-controls {
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}

	.delete-button {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.375rem;
		border: none;
		border-radius: 0.25rem;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: background-color 120ms ease, color 120ms ease;
	}

	.delete-button:hover {
		background: var(--background-modifier-hover);
		color: var(--text-error);
	}

	.delete-button.confirm {
		color: var(--text-success);
	}

	.delete-button.confirm:hover {
		color: var(--text-success);
	}
</style>
