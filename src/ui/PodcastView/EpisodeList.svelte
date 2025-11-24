<script lang="ts">
	import type { Episode } from "src/types/Episode";
	import { createEventDispatcher } from "svelte";
	import EpisodeListItem from "./EpisodeListItem.svelte";
	import { hidePlayedEpisodes, playedEpisodes } from "src/store";
	import Icon from "../obsidian/Icon.svelte";
	import Text from "../obsidian/Text.svelte";
	import Loading from "./Loading.svelte";
	import { getEpisodeKey } from "src/utility/episodeKey";

	export let episodes: Episode[] = [];
	export let showThumbnails: boolean = false;
	export let showListMenu: boolean = true;
	export let isLoading: boolean = false;
	let searchInputQuery: string = "";

	function isEpisodeFinished(episode: Episode | null | undefined, playedEps: typeof $playedEpisodes): boolean {
		if (!episode) return false;
		const key = getEpisodeKey(episode);
		// Check composite key first, then fall back to title-only for backwards compat
		return (key && playedEps[key]?.finished) || playedEps[episode.title]?.finished || false;
	}

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
			{@const episodePlayed = isEpisodeFinished(episode, $playedEpisodes)}
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
		height: 100%;
		overflow: hidden;
	}

	.podcast-episode-list {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		width: 100%;
		flex: 1 1 auto;
		overflow-y: auto;
		overflow-x: hidden;
	}

	.podcast-episode-list p {
		padding: 1.5rem;
		text-align: center;
		color: var(--text-muted);
	}

	.episode-list-menu {
		display: flex;
		flex-direction: row;
		justify-content: flex-end;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}

	.episode-list-search {
		flex: 1 1 auto;
		min-width: 0;
	}

	.episode-list-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 2rem 1rem;
		color: var(--text-muted);
		font-size: 0.9rem;
	}
</style>
