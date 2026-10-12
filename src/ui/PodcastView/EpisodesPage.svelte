<script lang="ts">
	import { debounce, Notice } from "obsidian";
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import type { FeedKey, LoadMode } from "src/services/FeedRepository";
	import { notifyPrivateFeedUnavailable } from "src/services/privateFeeds";
	import {
		downloadedEpisodes,
		episodeListLimit,
		favorites,
		localFiles,
		playedEpisodes,
		playlists,
		queue,
		savedFeeds,
	} from "src/store";
	import type { Episode } from "src/types/Episode";
	import {
		buildPlayedEpisodeListEntries,
		type EpisodeListEntry,
		type PlayedEpisodeListEntry,
	} from "src/utility/episodeListEntry";
	import searchEpisodes from "src/utility/searchEpisodes";
	import Icon from "../obsidian/Icon.svelte";
	import { useServices } from "./context";
	import EpisodeList from "./EpisodeList.svelte";
	import EpisodeListHeader from "./EpisodeListHeader.svelte";
	import {
		feedKeysWithPlayedEpisodes,
		selectFeedEpisodes,
		selectLatestEpisodes,
	} from "./episodeListSelection";
	import type { ListPage } from "./pages";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";

	let { page }: { page: ListPage } = $props();
	const { player, feeds, navigation } = useServices();
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
	const shownEpisodes = $derived(
		feedState
			? selectFeedEpisodes(feedState, $downloadedEpisodes)
			: (playlist?.episodes ?? selectLatestEpisodes($feeds, $episodeListLimit)),
	);
	const playedEntries = $derived(
		page.kind === "played"
			? filterPlayedEntries(
					buildPlayedEpisodeListEntries($playedEpisodes, [
						...Array.from($feeds.values(), ({ episodes }) => episodes),
						...Object.values($downloadedEpisodes),
						$queue.episodes,
						$favorites.episodes,
						$localFiles.episodes,
						...Object.values($playlists).map(({ episodes }) => episodes),
					]),
					query,
				)
			: null,
	);
	const episodes = $derived(
		playedEntries
			? playedEntries.map(({ episode }) => episode)
			: searchEpisodes(query, shownEpisodes),
	);

	// The open podcast's own loading shows as the list's spinner, so the banner leaves it out.
	const bannerFeedNames = $derived(
		Array.from($feeds.values())
			.filter((state) => state.status === "loading" && state !== feedState)
			.map(({ feed }) => feed.title),
	);
	const loadingFeedSummary = $derived(
		bannerFeedNames.length > 3
			? `${bannerFeedNames.slice(0, 3).join(", ")} +${bannerFeedNames.length - 3} more`
			: bannerFeedNames.join(", "),
	);

	// On mount, not on the click that opened the page, so a page restored at startup loads too.
	onMount(() => {
		if (page.kind === "feed") void loadFeed(page.key, "complete");
		if (page.kind === "played") void loadPlayedFeeds("complete");
	});

	function filterPlayedEntries(
		entries: PlayedEpisodeListEntry[],
		search: string,
	): PlayedEpisodeListEntry[] {
		if (!search) return entries;

		const entriesByEpisode = new Map(entries.map((entry) => [entry.episode, entry]));

		return searchEpisodes(
			search,
			entries.map((entry) => entry.episode),
		)
			.map((episode) => entriesByEpisode.get(episode))
			.filter((entry): entry is PlayedEpisodeListEntry => Boolean(entry));
	}

	function getPlayedEpisodeKey(entry: EpisodeListEntry): string | undefined {
		if (!("playedEpisodeKey" in entry)) return undefined;

		return typeof entry.playedEpisodeKey === "string" ? entry.playedEpisodeKey : undefined;
	}

	// Only an interactive load reports a failure. A network failure is reported
	// only when nothing can be shown.
	async function loadFeed(key: FeedKey, mode: LoadMode) {
		await feeds.load([key], mode);
		const state = get(feeds).get(key);
		if (state?.error === "unavailable") {
			notifyPrivateFeedUnavailable(state.feed.title);
		} else if (
			state?.error === "network" &&
			selectFeedEpisodes(state, get(downloadedEpisodes)).length === 0
		) {
			new Notice(
				`Could not load episodes for ${state.feed.title}. Check your connection and try again.`,
			);
		}
	}

	function loadPlayedFeeds(mode: LoadMode) {
		return feeds.load(feedKeysWithPlayedEpisodes(get(savedFeeds), get(playedEpisodes)), mode);
	}

	function handleClickEpisode(event: CustomEvent<{ episode: Episode; entry: EpisodeListEntry }>) {
		const { episode, entry } = event.detail;
		if (!entry.isAvailable) {
			new Notice("This played episode is no longer available in current feeds.");
			return;
		}

		player.play(episode);
		navigation.expand();
	}

	function handleContextMenuEpisode({
		detail: { event, episode, entry },
	}: CustomEvent<{ episode: Episode; entry: EpisodeListEntry; event: MouseEvent }>) {
		spawnEpisodeContextMenu(
			episode,
			event,
			entry.isAvailable
				? undefined
				: {
						play: true,
						download: true,
						createNote: true,
						favorite: true,
						queue: true,
						playlists: true,
					},
			getPlayedEpisodeKey(entry),
			page.kind === "queue",
		);
	}

	function handleClickRefresh() {
		if (page.kind === "feed") void loadFeed(page.key, "network");
		else if (page.kind === "played") void loadPlayedFeeds("network");
		else if (page.kind === "latest") void feeds.load(get(feeds).keys(), "network");
	}

	const handleSearch = debounce((event: CustomEvent<{ query: string }>) => {
		query = event.detail.query;
	}, 250);
</script>

{#if bannerFeedNames.length > 0}
	<div class="feed-loading-banner">
		<div class="feed-loading-spinner">
			<Icon icon="loader-2" size={18} clickable={false} />
		</div>
		<div class="feed-loading-text">
			<span>
				Updating {bannerFeedNames.length} feed{bannerFeedNames.length === 1 ? "" : "s"}
			</span>
			{#if loadingFeedSummary}
				<span class="feed-loading-names">{loadingFeedSummary}</span>
			{/if}
		</div>
	</div>
{/if}
<EpisodeList
	{episodes}
	episodeEntries={playedEntries}
	showThumbnails={page.kind !== "queue" && page.kind !== "local" && page.kind !== "playlist"}
	showPlayedToggle={page.kind !== "played"}
	alwaysShowPlayedEpisodes={page.kind === "played"}
	isLoading={feedState ? feedState.status === "loading" : bannerFeedNames.length > 0}
	on:clickEpisode={handleClickEpisode}
	on:contextMenuEpisode={handleContextMenuEpisode}
	on:clickRefresh={handleClickRefresh}
	on:search={handleSearch}
>
	<svelte:fragment slot="header">
		{#if feedState}
			<EpisodeListHeader text={feedState.feed.title} artworkUrl={feedState.feed.artworkUrl} />
		{/if}
	</svelte:fragment>
</EpisodeList>

<style>
	.feed-loading-banner {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.625rem 0.75rem;
		background: var(--background-secondary);
		border-bottom: 1px solid var(--background-modifier-border);
		box-sizing: border-box;
	}

	.feed-loading-spinner {
		display: inline-flex;
		color: var(--interactive-accent);
		animation: spin 1s linear infinite;
	}

	.feed-loading-text {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
		font-size: 0.85rem;
		color: var(--text-normal);
	}

	.feed-loading-names {
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}

		to {
			transform: rotate(360deg);
		}
	}
</style>
