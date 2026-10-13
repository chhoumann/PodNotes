<script lang="ts">
	import { useServices } from "./context";
	import type { ListEntry } from "./episodeListSelection";
	import { rowKeys } from "./episodeRow";
	import EpisodeRow from "./EpisodeRow.svelte";
	import { episodeMenu, openEpisode, showMenu } from "./menus";

	let {
		entries,
		cover = false,
		date = !cover,
	}: {
		entries: readonly ListEntry[];
		cover?: boolean;
		date?: boolean;
	} = $props();
	const services = useServices();
</script>

<div class="pn-list" role="list">
	{#each rowKeys(entries) as [key, entry] (key)}
		{@const { episode, isAvailable } = entry}
		<EpisodeRow
			{episode}
			{cover}
			{date}
			available={isAvailable}
			onplay={() => openEpisode(services, episode, isAvailable)}
			onmenu={(at) =>
				showMenu(
					episodeMenu(episode, services, {
						place: "list",
						at,
						available: isAvailable,
						playedKey: entry.playedEpisodeKey,
					}),
					at,
				)}
		/>
	{/each}
</div>
