<script lang="ts">
	import { PodcastFeed } from "src/types/PodcastFeed";
	import FeedGrid from "./PodcastGrid.svelte";
	import {
		currentEpisode,
		savedFeeds,
		episodeCache,
playlists,
queue,
favorites,
	} from "src/store";
	import EpisodePlayer from "./EpisodePlayer.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import { Episode } from "src/types/Episode";
	import FeedParser from "src/parser/feedParser";
	import TopBar from "./TopBar.svelte";
	import { ViewState } from "src/types/ViewState";
	import { onMount } from "svelte";
	import EpisodeListHeader from "./EpisodeListHeader.svelte";
	import Icon from "../obsidian/Icon.svelte";
	import { debounce, Menu } from "obsidian";
	import searchEpisodes from "src/utility/searchEpisodes";
	import { Playlist } from "src/types/Playlist";
import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";

	let feeds: PodcastFeed[] = [];
	let selectedFeed: PodcastFeed | null = null;
	let displayedEpisodes: Episode[] = [];
	let displayedPlaylists: Playlist[] = [];
	let latestEpisodes: Episode[] = [];
	let _viewState: ViewState;

	let view: HTMLDivElement;

	function updateViewState(viewState: ViewState) {
		_viewState = viewState;

		view.scrollIntoView();
	}

	onMount(async () => {
		await fetchEpisodesInAllFeeds(feeds);

		const unsubscribeEpisodeCache = episodeCache.subscribe((cache) => {
			latestEpisodes = Object.entries(cache)
				.map(([_, episodes]) => episodes.splice(0, 10))
				.flat()
				.sort((a, b) => {
					if (a.episodeDate && b.episodeDate)
						return Number(b.episodeDate) - Number(a.episodeDate);

					return 0;
				});
		});

		const unsubscribeSavedFeeds = savedFeeds.subscribe((storeValue) => {
			feeds = Object.values(storeValue);
		});

		const unsubscribePlaylists = playlists.subscribe((pl) => {
			displayedPlaylists = [$queue, $favorites, ...Object.values(pl)];
		});

		if (!selectedFeed) {
			displayedEpisodes = latestEpisodes;
		}

		return () => {
			unsubscribeEpisodeCache();
			unsubscribeSavedFeeds();
			unsubscribePlaylists();
		};
	});


	async function fetchEpisodes(
		feed: PodcastFeed,
		useCache: boolean = true
	): Promise<Episode[]> {
		const cachedEpisodesInFeed = $episodeCache[feed.title];

		if (
			useCache &&
			cachedEpisodesInFeed &&
			cachedEpisodesInFeed.length > 0
		) {
			return cachedEpisodesInFeed;
		}

		const episodes = await new FeedParser(feed).getEpisodes(feed.url);

		episodeCache.update((cache) => ({
			...cache,
			[feed.title]: episodes,
		}));

		return episodes;
	}

	function fetchEpisodesInAllFeeds(
		feedsToSearch: PodcastFeed[]
	): Promise<Episode[]> {
		return Promise.all(
			feedsToSearch.map((feed) => fetchEpisodes(feed))
		).then((episodes) => {
			return episodes.flat();
		});
	}

	async function handleClickPodcast(
		event: CustomEvent<{ feed: PodcastFeed }>
	) {
		const { feed } = event.detail;
		displayedEpisodes = [];

		selectedFeed = feed;
		displayedEpisodes = await fetchEpisodes(feed);
		updateViewState(ViewState.EpisodeList);
	}

	function handleClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		const { episode } = event.detail;
		currentEpisode.set(episode);

		updateViewState(ViewState.Player);
	}

	function handleContextMenuEpisode({detail: {event, episode}}: CustomEvent<{ episode: Episode, event: MouseEvent }>) {
		spawnEpisodeContextMenu(episode, event, () => {
			updateViewState(ViewState.Player);
		});
	}

	async function handleClickRefresh() {
		if (!selectedFeed) return;

		displayedEpisodes = await fetchEpisodes(selectedFeed, false);
	}

	const handleSearch = debounce((event: CustomEvent<{ query: string }>) => {
		const { query } = event.detail;

		if (selectedFeed) {
			const episodesInFeed = $episodeCache[selectedFeed.title];
			displayedEpisodes = searchEpisodes(query, episodesInFeed);
			return;
		}

		displayedEpisodes = searchEpisodes(query, latestEpisodes);
	}, 250);
</script>

<div class="podcast-view" bind:this={view}>
	<TopBar
		bind:viewState={_viewState}
		canShowEpisodeList={true}
		canShowPlayer={!!$currentEpisode}
	/>

	{#if _viewState === ViewState.Player}
		<EpisodePlayer />
	{:else if _viewState === ViewState.EpisodeList}
		<EpisodeList
			episodes={displayedEpisodes}
			showThumbnails={!selectedFeed}
			on:clickEpisode={handleClickEpisode}
			on:contextMenuEpisode={handleContextMenuEpisode}
			on:clickRefresh={handleClickRefresh}
			on:search={handleSearch}
		>
			<svelte:fragment slot="header">
				{#if selectedFeed}
					<span
						class="go-back"
						on:click={() => {
							selectedFeed = null;
							displayedEpisodes = latestEpisodes;
							updateViewState(ViewState.EpisodeList);
						}}
					>
						<Icon
							icon={"arrow-left"}
							style={{
								display: "flex",
								"align-items": "center",
							}}
							size={20}
						/> Latest Episodes
					</span>
					<EpisodeListHeader
						text={selectedFeed.title}
						artworkUrl={selectedFeed.artworkUrl}
					/>
				{:else}
					<EpisodeListHeader text="Latest Episodes" />
				{/if}
			</svelte:fragment>
		</EpisodeList>
	{:else if _viewState === ViewState.PodcastGrid}
		<FeedGrid {feeds} playlists={displayedPlaylists} on:clickPodcast={handleClickPodcast} />
	{/if}
</div>

<style>
	.podcast-view {
		display: flex;
		flex-direction: column;
		height: 100%;
	}

	.go-back {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem;
		gap: 0.5rem;
		cursor: pointer;
		margin-right: auto;
		opacity: 0.75;
	}

	.go-back:hover {
		opacity: 1;
	}
</style>
