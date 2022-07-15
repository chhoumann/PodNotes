<script lang="ts">
	import { Episode } from "src/types/Episode";
	import { createEventDispatcher, onMount } from "svelte";
	import EpisodeListItem from "./EpisodeListItem.svelte";
	import { playedEpisodes } from "src/store";
	import Icon from "../obsidian/Icon.svelte";
	import Text from "../obsidian/Text.svelte";

	export let episodes: Episode[] = [];
	export let showThumbnails: boolean = false;
	let hidePlayedEpisodes: boolean = false;
	let searchInputQuery: string = "";

	const dispatch = createEventDispatcher();

	function forwardClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		dispatch("clickEpisode", { episode: event.detail.episode });
	}

	function forwardSearchInput(event: CustomEvent<{ value: string }>) {
		dispatch("search", { query: event.detail.value });
	}
</script>

<div class="episode-list-view-container">
	<slot name="header">Fallback</slot>

	<div class="episode-list-menu">
		<div class="episode-list-search">
			<Text 
			 	bind:value={searchInputQuery}
				on:change={forwardSearchInput}
				placeholder="Search episodes"
				style={{
					width: "100%",
				}}
			/>
		</div>
		<Icon 
			icon={hidePlayedEpisodes ? "eye-off" : "eye"}
			size={25}
			on:click={() => hidePlayedEpisodes = !hidePlayedEpisodes}
		/>
		<Icon
			 icon="refresh-cw"
			 size={25}
			 on:click={() => dispatch("clickRefresh")}
		/>
	</div>

	<div class="podcast-episode-list">
		{#if episodes.length === 0}
			<p>No episodes found.</p>
		{/if}
		{#each episodes as episode}
			{@const episodePlayed = $playedEpisodes[episode.title]?.finished}
			{#if !hidePlayedEpisodes || !episodePlayed}
				<EpisodeListItem
					episode={episode}
					episodeFinished={episodePlayed}
					showEpisodeImage={showThumbnails}
					on:clickEpisode={forwardClickEpisode} 
				/>
			{/if}
		{/each}
	</div>
</div>

<style>
	.episode-list-view-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
	}

	.podcast-episode-list {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
	}

	.episode-list-menu {
		display: flex;
		flex-direction: row;
		justify-content: right;
		align-items: center;
		gap: 1rem;
		width: 100%;
		padding-left: 0.5rem;
		padding-right: 0.5rem;
	}

	.episode-list-search {
		width: 100%;
		margin-bottom: 0.5rem;
	}
</style>

