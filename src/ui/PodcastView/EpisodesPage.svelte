<script lang="ts">
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import type { FeedState, LoadMode } from "src/services/FeedRepository";
	import {
		buildPlayedEpisodeListEntries,
		createEpisodeListEntries,
		type EpisodeListEntry,
	} from "src/utility/episodeListEntry";
	import { isEpisodeFinished } from "src/utility/episodeStatus";
	import checkStringIsUrl from "src/utility/checkStringIsUrl";
	import { isPrivateFeedPlaceholder } from "src/utility/privateFeedUrl";
	import searchEpisodes from "src/utility/searchEpisodes";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import {
		feedKeysWithPlayedEpisodes,
		selectFeedEpisodes,
		selectLatestEpisodes,
	} from "./episodeListSelection";
	import { rowKeys } from "./episodeRow";
	import EpisodeRow from "./EpisodeRow.svelte";
	import { episodeMenu, openEpisode, showMenu } from "./menus";
	import type { ListPage } from "./pages";
	import SearchField from "./SearchField.svelte";

	let { page }: { page: ListPage } = $props();
	const services = useServices();
	const { feeds, actions, library } = services;
	const {
		savedFeeds,
		queue,
		favorites,
		playlists,
		localFiles,
		playedEpisodes,
		downloadedEpisodes,
		episodeListLimit,
		hidePlayedEpisodes,
	} = library;
	let query = $state("");

	const feedState = $derived(page.kind === "feed" ? $feeds.get(page.key) : undefined);
	const playlist = $derived(
		page.kind === "queue"
			? $queue
			: page.kind === "local"
				? $localFiles
				: page.kind === "playlist"
					? [$favorites, ...Object.values($playlists)].find(
							({ name }) => name === page.name,
						)
					: undefined,
	);
	const entries: (EpisodeListEntry & { playedEpisodeKey?: string })[] = $derived.by(() => {
		if (page.kind === "played") {
			const played = buildPlayedEpisodeListEntries($playedEpisodes, [
				...Array.from($feeds.values(), ({ episodes }) => episodes),
				...Object.values($downloadedEpisodes),
				$queue.episodes,
				$favorites.episodes,
				$localFiles.episodes,
				...Object.values($playlists).map(({ episodes }) => episodes),
			]);
			// The search's order, best match first, not the Played order.
			const entryOf = new Map(played.map((entry) => [entry.episode, entry]));
			return searchEpisodes(
				query,
				played.map(({ episode }) => episode),
			).flatMap((episode) => entryOf.get(episode) ?? []);
		}
		const listed = createEpisodeListEntries(
			searchEpisodes(
				query,
				page.kind === "feed"
					? feedState
						? selectFeedEpisodes(feedState, $downloadedEpisodes)
						: []
					: page.kind === "latest"
						? selectLatestEpisodes($feeds, $episodeListLimit)
						: (playlist?.episodes ?? []),
			),
		);
		return $hidePlayedEpisodes
			? listed.filter(({ episode }) => !isEpisodeFinished(episode, $playedEpisodes))
			: listed;
	});
	const loading = $derived(
		feedState
			? feedState.status === "loading"
			: (page.kind === "latest" || page.kind === "played") &&
					Array.from($feeds.values()).some(({ status }) => status === "loading"),
	);

	// On mount, not on the click that opened the page, so a page restored at startup loads too.
	onMount(() => {
		if (page.kind === "feed") void feeds.load([page.key], "complete");
		if (page.kind === "played") void loadPlayedFeeds("complete");
	});

	function loadPlayedFeeds(mode: LoadMode) {
		return feeds.load(feedKeysWithPlayedEpisodes(get(savedFeeds), get(playedEpisodes)), mode);
	}

	function refresh() {
		if (page.kind === "feed") void feeds.load([page.key], "network");
		else if (page.kind === "played") void loadPlayedFeeds("network");
		else void feeds.load(get(feeds).keys(), "network");
	}

	/** Which server failed, without the address: a private feed's address is a secret. */
	function failedSource({ error, feed }: FeedState): string {
		if (error === "unavailable") return "Address not on this device";
		if (isPrivateFeedPlaceholder(feed.url)) return "Private feed";
		return checkStringIsUrl(feed.url)?.host ?? "";
	}
</script>

{#if feedState && page.kind === "feed"}
	{@const { feed, channel, error } = feedState}
	{@const key = page.key}
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
				<button type="button" class="pn-btn" disabled={loading} onclick={refresh}
					>Retry</button
				>
			{/if}
		</div>
	{/if}
{/if}

<div class="pn-filter">
	<SearchField value={query} placeholder="Search episodes" oninput={(value) => (query = value)} />
	{#if page.kind !== "played"}
		{@const label = $hidePlayedEpisodes ? "Show played episodes" : "Hide played episodes"}
		<button
			type="button"
			class="pn-iconbtn"
			aria-pressed={$hidePlayedEpisodes}
			aria-label={label}
			title={label}
			onclick={() => hidePlayedEpisodes.update((hidden) => !hidden)}
			{@attach icon("eye-off")}
		></button>
	{/if}
	{#if page.kind === "feed" || page.kind === "latest" || page.kind === "played"}
		<button
			type="button"
			class="pn-iconbtn"
			aria-label="Refresh episodes"
			title="Refresh episodes"
			onclick={refresh}
			{@attach icon("refresh-cw")}
		></button>
	{/if}
</div>

{#if loading}
	<div class="pn-count" role="status">Loading episodes</div>
{/if}
{#if entries.length > 0}
	<div class="pn-list" role="list">
		{#each rowKeys(entries) as [key, entry] (key)}
			{@const { episode, isAvailable } = entry}
			<EpisodeRow
				{episode}
				available={isAvailable}
				cover={page.kind === "latest" || page.kind === "played"}
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
{:else if !loading}
	<div class="pn-panel-empty">
		{query || ($hidePlayedEpisodes && page.kind !== "played")
			? "No episodes match"
			: "No episodes"}
	</div>
{/if}
