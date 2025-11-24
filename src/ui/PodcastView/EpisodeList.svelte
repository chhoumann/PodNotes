<script lang="ts">
	import type { Episode } from "src/types/Episode";
	import { createEventDispatcher } from "svelte";
	import EpisodeListItem from "./EpisodeListItem.svelte";
	import { hidePlayedEpisodes, playedEpisodes } from "src/store";
	import Icon from "../obsidian/Icon.svelte";
	import Text from "../obsidian/Text.svelte";
	import Loading from "./Loading.svelte";

	export let episodes: Episode[] = [];
	export let showThumbnails: boolean = false;
	export let showListMenu: boolean = true;
	export let isLoading: boolean = false;
	let searchInputQuery: string = "";

	const dispatch = createEventDispatcher();

	function forwardClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		dispatch("clickEpisode", { episode: event.detail.episode });
	}

	function forwardContextMenuEpisode(
		event: CustomEvent<{ episode: Episode; event: MouseEvent }>
	) {
		dispatch("contextMenuEpisode", {
			episode: event.detail.episode,
			event: event.detail.event,
		});
	}

	function forwardSearchInput(event: CustomEvent<{ value: string }>) {
		dispatch("search", { query: event.detail.value });
	}
</script>

<div class="episode-list-view-container">
	<slot name="header">Fallback</slot>

	{#if showListMenu}
		<div class="episode-list-menu">
			<div class="episode-list-search">
				<Text
					bind:value={searchInputQuery}
					on:input={forwardSearchInput}
					placeholder="Search episodes"
					style={{
						width: "100%",
					}}
				/>
			</div>
			<Icon
				icon={$hidePlayedEpisodes ? "eye-off" : "eye"}
				size={25}
				label={$hidePlayedEpisodes ? "Show played episodes" : "Hide played episodes"}
				pressed={$hidePlayedEpisodes}
				on:click={() => hidePlayedEpisodes.update((value) => !value)}
			/>
			<Icon
				icon="refresh-cw"
				size={25}
				label="Refresh episodes"
				on:click={() => dispatch("clickRefresh")}
			/>
		</div>
	{/if}

	<div class="podcast-episode-list">
		{#if isLoading}
			<div class="episode-list-loading" role="status" aria-live="polite">
				<Loading />
				<span>Fetching episodes...</span>
			</div>
		{/if}
		{#if episodes.length === 0 && !isLoading}
			<p>No episodes found.</p>
		{/if}
		{#each episodes as episode (episode.url || episode.streamUrl || `${episode.title}-${episode.episodeDate ?? ""}`)}
			{@const episodePlayed = $playedEpisodes[episode.title]?.finished}
			{#if !$hidePlayedEpisodes || !episodePlayed}
				<EpisodeListItem
					{episode}
					episodeFinished={episodePlayed}
					showEpisodeImage={showThumbnails}
					on:clickEpisode={forwardClickEpisode}
					on:contextMenu={forwardContextMenuEpisode}
				/>
			{/if}
		{/each}
	</div>
</div>

<style>
	.episode-list-view-container {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		width: 100%;
	}

	.podcast-episode-list {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		width: 100%;
		height: 100%;
		gap: 0.25rem;
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

	.episode-list-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 1rem 0;
		color: var(--text-muted);
	}
</style>
