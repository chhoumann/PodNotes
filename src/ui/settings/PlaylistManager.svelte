<script lang="ts">
	import { playlists } from "src/store";
	import { Playlist } from "src/types/Playlist";
	import { onMount } from "svelte";
	import Button from "../obsidian/Button.svelte";
	import Text from "../obsidian/Text.svelte";
	import PlaylistItem from "./PlaylistItem.svelte";
	import Dropdown from "../obsidian/Dropdown.svelte";
	import { IconType, ICON_LIST } from "src/types/IconType";

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
		playlists.update((value) => {
			value[playlistInput] = {
				name: playlistInput,
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

	function onToggleRepeat(event: CustomEvent<{ value: Playlist }>) {
		playlists.update((value) => {
			value[event.detail.value.name].shouldRepeat =
				!value[event.detail.value.name].shouldRepeat;
			return value;
		});
	}
</script>

<div class="playlist-manager-container">
	<div class="playlist-list">
		{#each playlistArr as playlist}
			<PlaylistItem
				{playlist}
				on:delete={onDeletePlaylist}
				on:toggleRepeat={onToggleRepeat}
			/>
		{/each}
	</div>

	<div class="add-playlist-container">
		<Dropdown {options} bind:value={icon} on:change={onChangeIcon} />
		<Text placeholder="Playlist name" bind:value={playlistInput} />
		<Button icon="plus" cta={true} on:click={onAddPlaylist} />
	</div>
</div>

<style>
	.playlist-manager-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		margin-bottom: 2rem;
	}

	.playlist-list {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		overflow-y: auto;
	}

	.add-playlist-container {
		margin-top: 1rem;
	}
</style>
