<script lang="ts">
	import { PodcastFeed } from "src/types/PodcastFeed";
	import FeedGrid from "./PodcastGrid.svelte";
	import {
		currentEpisode,
		savedFeeds,
		episodeCache,
	} from "src/store";
	import EpisodePlayer from "./EpisodePlayer.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import { Episode } from "src/types/Episode";
	import FeedParser from "src/parser/feedParser";
	import TopBar from "./TopBar.svelte";
	import { ViewState } from "src/types/ViewState";
	import { onDestroy, onMount } from "svelte";
	import EpisodeListHeader from "./EpisodeListHeader.svelte";
	import Icon from "../obsidian/Icon.svelte";
	import { debounce } from "obsidian";
	import searchEpisodes from "src/utility/searchEpisodes";

	let feeds: PodcastFeed[] = [];
	let selectedFeed: PodcastFeed | null = null;
	let displayedEpisodes: Episode[] = [];
	let latestEpisodes: Episode[] = [];
	let _viewState: ViewState;

	let view: HTMLDivElement;

	function updateViewState(viewState: ViewState) {
		_viewState = viewState;

		view.scrollIntoView();
	}

	onMount(async () => {
		await fetchEpisodesInAllFeeds(feeds);

		const unsubscribe = episodeCache.subscribe((cache) => {
			latestEpisodes = Object.entries(cache)
				.map(([_, episodes]) => episodes.splice(0, 10))
				.flat()
				.sort((a, b) => {
					if (a.episodeDate && b.episodeDate)
						return Number(b.episodeDate) - Number(a.episodeDate)
					
					return 0;
				});
		});

		if (!selectedFeed) {
			displayedEpisodes = latestEpisodes;
		}

		return () => {
			unsubscribe();
		};
	});

	const unsubscribe = savedFeeds.subscribe((storeValue) => {
		feeds = Object.values(storeValue);
	});

	async function fetchEpisodes(feed: PodcastFeed, useCache: boolean = true): Promise<Episode[]> {
		const cachedEpisodesInFeed = $episodeCache[feed.title];

		if (useCache && cachedEpisodesInFeed && cachedEpisodesInFeed.length > 0) {
			return cachedEpisodesInFeed;
		}
		
		const episodes = await new FeedParser(feed).parse(feed.url);

		episodeCache.update((cache) => ({
			...cache,
			[feed.title]: episodes,
		}));

		return episodes;
	}

	function fetchEpisodesInAllFeeds(feedsToSearch: PodcastFeed[]): Promise<Episode[]> {
		return Promise.all(feedsToSearch.map((feed) => fetchEpisodes(feed))).then((episodes) => {
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

	async function handleClickRefresh() {
		if (!selectedFeed) return;

		displayedEpisodes = await fetchEpisodes(selectedFeed, false);
	}

	const handleSearch = debounce((event: CustomEvent<{query: string}>) => {
		const { query } = event.detail;

		if (selectedFeed) {
			const episodesInFeed = $episodeCache[selectedFeed.title];
			displayedEpisodes = searchEpisodes(query, episodesInFeed);
			return;
		}

		displayedEpisodes = searchEpisodes(query, latestEpisodes);
	}, 250);

	onDestroy(unsubscribe);
</script>

<div 
	class="podcast-view"
	bind:this={view}
>
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
		<FeedGrid {feeds} on:clickPodcast={handleClickPodcast} />
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
