<script lang="ts">
	import { Episode } from "src/types/Episode";
	import { PodcastFeed } from "src/types/PodcastFeed";
	import { createEventDispatcher, onMount } from "svelte";
	import EpisodeListItem from "./EpisodeListItem.svelte";
	import { playedEpisodes } from "src/store";
	import Icon from "../Icon.svelte";
	import { debounce, TextComponent } from "obsidian";
	import Fuse from "fuse.js";

	export let episodes: Episode[] = [];
	export let feed: PodcastFeed | null = null;
	let hidePlayedEpisodes: boolean = false;
	let searchInputRef: HTMLSpanElement;

	let displayedEpisodes: Episode[] = [];

	const dispatch = createEventDispatcher();

	function forwardClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		dispatch("clickEpisode", { episode: event.detail.episode });
	}

	function searchEpisodes(query: string) {
		if (query.length === 0) {
			displayedEpisodes = episodes;
			return;
		} 

		const fuse = new Fuse(episodes, {
			shouldSort: true,
			findAllMatches: true,
			threshold: 0.4,
			isCaseSensitive: false,
			keys: ['title'],
		});
		
		const searchResults = fuse.search(query);
		displayedEpisodes = searchResults.map(resItem => resItem.item);
	}

	onMount(() => {
		displayedEpisodes = episodes;

		const searchComponent = new TextComponent(searchInputRef)
			.setPlaceholder("Search episodes")
			.onChange(debounce(searchEpisodes, 250));

		searchComponent.inputEl.style.width = "100%";
	});
</script>

<div class="episode-list-view-container">
	<div class="podcast-header">
		<img id="podcast-artwork" src={feed?.artworkUrl} alt={feed?.title} />
		<h2 class="podcast-heading">{feed?.title}</h2>
	</div>

	<div class="episode-list-menu">
		<div class="episode-list-search">
			<span bind:this={searchInputRef} />
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
		{#each displayedEpisodes as episode}
			{@const episodePlayed = $playedEpisodes[episode.title]?.finished}
			{#if !hidePlayedEpisodes || !episodePlayed}
				<EpisodeListItem
					episode={episode}
					episodeFinished={episodePlayed}
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

	.podcast-header {
		display: flex;
		flex-direction: column;
		justify-content: space-around;
		align-items: center;
		padding: 0.5rem;
	}

	.podcast-heading {
		text-align: center;
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

