<script lang="ts">
	import { Notice } from "obsidian";
	import { get } from "svelte/store";
	import { favorites, playlists, queue } from "src/store";
	import type { Playlist } from "src/types/Playlist";
	import { onMount } from "svelte";
	import Button from "../obsidian/Button.svelte";
	import Text from "../obsidian/Text.svelte";
	import PlaylistItem from "./PlaylistItem.svelte";
	import Dropdown from "../obsidian/Dropdown.svelte";
	import type { IconType } from "src/types/IconType";
	import { ICON_LIST } from "src/types/IconType";

	let playlistArr: Playlist[] = [];
	let playlistInput: string = "";
	let options: Record<string, string> = ICON_LIST.reduce<{
		[icon: string]: string;
	}>((acc, curr) => {
		acc[curr] = curr;
		return acc;
	}, {});
	let icon: IconType = ICON_LIST[0];

	onMount(() => {
		const unsubscribe = playlists.subscribe((playlists) => {
			playlistArr = Object.values(playlists);
		});

		return () => {
			unsubscribe();
		};
	});

	function onAddPlaylist() {
		const name = playlistInput.trim();

		if (!name) {
			new Notice("Playlist name cannot be empty.");
			return;
		}

		if (Object.prototype.hasOwnProperty.call(get(playlists), name)) {
			new Notice("A playlist with that name already exists.");
			return;
		}

		playlists.update((value) => {
			value[name] = {
				name,
				icon: icon,
				episodes: [],
				shouldEpisodeRemoveAfterPlay: false,
				shouldRepeat: false,
			};

			return value;
		});

		playlistInput = "";
		icon = ICON_LIST[0];
	}

	function onChangeIcon(event: CustomEvent<{ value: IconType }>) {
		icon = event.detail.value;
	}

	function onDeletePlaylist(event: CustomEvent<{ value: Playlist }>) {
		playlists.update((value) => {
			delete value[event.detail.value.name];
			return value;
		});
	}
</script>

<div class="playlist-manager-container">
	<div class="playlist-list">
		<PlaylistItem
			playlist={$queue}
			showDeleteButton={false}
		/>
		<PlaylistItem
			playlist={$favorites}
			showDeleteButton={false}
		/>
		{#each playlistArr as playlist (playlist.name)}
			<PlaylistItem
				{playlist}
				on:delete={onDeletePlaylist}
			/>
		{/each}
	</div>

	<div class="add-playlist-container">
		<Dropdown {options} bind:value={icon} on:change={onChangeIcon} />
		<Text placeholder="Playlist name" bind:value={playlistInput} />
		<Button
			text="Add"
			cta={true}
			ariaLabel="Add playlist"
			on:click={onAddPlaylist}
		/>
	</div>
</div>

<style>
	.playlist-manager-container {
		display: flex;
		flex-direction: column;
		width: 100%;
		margin-bottom: 1.5rem;
	}

	.playlist-list {
		display: flex;
		flex-direction: column;
		width: 100%;
		border: 1px solid var(--background-modifier-border);
		border-radius: 0.5rem;
		overflow: hidden;
	}

	.add-playlist-container {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 1rem;
	}
</style>
