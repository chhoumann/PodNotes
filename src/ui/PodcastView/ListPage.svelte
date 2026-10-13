<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import EpisodeList from "./EpisodeList.svelte";
	import { feedKeysWithPlayedEpisodes, selectListEntries } from "./episodeListSelection";
	import type { ListPage } from "./pages";

	let { page }: { page: ListPage } = $props();
	const { feeds, library } = useServices();
	const {
		savedFeeds,
		queue,
		favorites,
		playlists,
		localFiles,
		playedEpisodes,
		downloadedEpisodes,
		episodeListLimit,
	} = library;

	const entries = $derived(
		selectListEntries(page, {
			feeds: $feeds,
			limit: $episodeListLimit,
			played: $playedEpisodes,
			downloads: $downloadedEpisodes,
			queue: $queue,
			favorites: $favorites,
			localFiles: $localFiles,
			playlists: $playlists,
		}),
	);
	const loading = $derived(
		(page.kind === "latest" || page.kind === "played") &&
			Array.from($feeds.values()).some(({ status }) => status === "loading"),
	);

	// On mount, not on the click that opened the page, so a page restored at startup loads too.
	onMount(() => {
		if (page.kind !== "played") return;
		void feeds.load(
			feedKeysWithPlayedEpisodes(get(savedFeeds), get(playedEpisodes)),
			"complete",
		);
	});
</script>

{#if loading}
	<div class="pn-count" role="status">Loading episodes</div>
{/if}
{#if entries.length > 0}
	<EpisodeList {entries} cover date={page.kind === "latest"} />
{:else if !loading}
	<div class="pn-panel-empty">
		<span class="pn-panel-empty-icon" {@attach icon("inbox")}></span>
		<span>Nothing here yet</span>
	</div>
{/if}
