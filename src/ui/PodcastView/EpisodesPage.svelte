<script lang="ts">
	import type { FeedKey, FeedState } from "src/services/FeedRepository";
	import { createEpisodeListEntries } from "src/utility/episodeListEntry";
	import { isEpisodeFinished } from "src/utility/episodeStatus";
	import checkStringIsUrl from "src/utility/checkStringIsUrl";
	import { isPrivateFeedPlaceholder } from "src/utility/privateFeedUrl";
	import searchEpisodes from "src/utility/searchEpisodes";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import { selectFeedEpisodes, shownFailure } from "./episodeListSelection";
	import SearchField from "./SearchField.svelte";

	/** A podcast's page, with its hero, its feed's state, and its episodes to search and filter. */
	let { key }: { key: FeedKey } = $props();
	const { feeds, actions, library, online } = useServices();
	const { playedEpisodes, downloadedEpisodes, hidePlayedEpisodes } = library;
	let query = $state("");

	const feedState = $derived($feeds.get(key));
	const entries = $derived.by(() => {
		const listed = createEpisodeListEntries(
			searchEpisodes(
				query,
				feedState ? selectFeedEpisodes(feedState, $downloadedEpisodes) : [],
			),
		);
		return $hidePlayedEpisodes
			? listed.filter(({ episode }) => !isEpisodeFinished(episode, $playedEpisodes))
			: listed;
	});
	const loading = $derived(feedState?.status === "loading");
	const hideLabel = $derived(
		$hidePlayedEpisodes ? "Show played episodes" : "Hide played episodes",
	);

	// Once open and online, not on the click that opened it, so a page restored at startup
	// or opened offline loads too.
	let loaded = false;
	$effect(() => {
		if (loaded || !$online) return;
		loaded = true;
		void feeds.load([key], "complete");
	});

	const refresh = () => void feeds.load([key], "network");

	/** Which server failed, without the address: a private feed's address is a secret. */
	function failedSource({ error, feed }: FeedState): string {
		if (error === "unavailable") return "Address not on this device";
		if (isPrivateFeedPlaceholder(feed.url)) return "Private feed";
		return checkStringIsUrl(feed.url)?.host ?? "";
	}
</script>

{#if feedState}
	{@const { feed, channel } = feedState}
	{@const error = shownFailure(feedState, $online)}
	<div class="pn-hero">
		<Cover src={feed.artworkUrl} title={feed.title} />
		<div>
			<h1 title={feed.title}>{feed.title}</h1>
			<div class="by">{channel?.author ?? feed.author ?? ""}</div>
		</div>
	</div>
	{#if error}
		<div class="pn-banner" role="alert">
			<span class="pn-banner-icon" {@attach icon("alert-triangle")}></span>
			<div class="txt">
				<div class="h">Feed didn't load</div>
				<div class="d">{failedSource(feedState)}</div>
			</div>
			{#if error === "unavailable"}
				<button type="button" class="pn-btn" onclick={() => actions.setFeedAddress(key)}>
					Set feed address
				</button>
			{:else}
				<button type="button" class="pn-btn" onclick={refresh}>Retry</button>
			{/if}
		</div>
	{/if}
{/if}

<div class="pn-filter">
	<SearchField value={query} placeholder="Search episodes" oninput={(value) => (query = value)} />
	<button
		type="button"
		class="pn-iconbtn"
		aria-pressed={$hidePlayedEpisodes}
		aria-label={hideLabel}
		title={hideLabel}
		onclick={() => hidePlayedEpisodes.update((hidden) => !hidden)}
		{@attach icon("eye-off")}
	></button>
	<button
		type="button"
		class="pn-iconbtn"
		aria-label="Refresh episodes"
		title="Refresh episodes"
		disabled={!$online}
		onclick={refresh}
		{@attach icon("refresh-cw")}
	></button>
</div>

{#if loading}
	<div class="pn-count" role="status">Loading episodes</div>
{/if}
{#if entries.length > 0}
	<EpisodeList {entries} />
{:else if !loading}
	<div class="pn-panel-empty">
		{query || $hidePlayedEpisodes ? "No episodes match" : "No episodes"}
	</div>
{/if}
