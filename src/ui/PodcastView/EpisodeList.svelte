<script lang="ts">
	import { useServices } from "./context";
	import { splitOffline, type ListEntry } from "./episodeListSelection";
	import { rowKeys } from "./episodeRow";
	import EpisodeRow from "./EpisodeRow.svelte";
	import { episodeMenu, openEpisode, showMenu } from "./menus";

	let {
		entries,
		cover = false,
		date = !cover,
		group = true,
	}: {
		entries: readonly ListEntry[];
		cover?: boolean;
		date?: boolean;
		/** Offline, the episodes that play come first, each part headed. Local files all play. */
		group?: boolean;
	} = $props();
	const services = useServices();
	const { online, library } = services;
	const { downloadedEpisodes } = library;
</script>

{#snippet rows(list: readonly ListEntry[])}
	<div class="pn-list" role="list">
		{#each rowKeys(list) as [key, entry] (key)}
			{@const { episode, isAvailable } = entry}
			<EpisodeRow
				{episode}
				{cover}
				{date}
				resolved={isAvailable}
				playedKey={entry.playedEpisodeKey}
				onplay={() => openEpisode(services, episode, isAvailable)}
				onmenu={(at) =>
					showMenu(
						episodeMenu(episode, services, {
							place: "list",
							at,
							resolved: isAvailable,
							playedKey: entry.playedEpisodeKey,
						}),
						at,
					)}
			/>
		{/each}
	</div>
{/snippet}

{#if group && !$online}
	{@const split = splitOffline(entries, $downloadedEpisodes)}
	{#if split.offline.length > 0}
		<h2 class="pn-h2 is-first">Available offline</h2>
		{@render rows(split.offline)}
	{/if}
	{#if split.online.length > 0}
		<h2 class="pn-h2" class:is-first={split.offline.length === 0}>Needs a connection</h2>
		{@render rows(split.online)}
	{/if}
{:else}
	{@render rows(entries)}
{/if}
