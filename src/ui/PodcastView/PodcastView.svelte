<script lang="ts">
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import PodcastGrid from "./PodcastGrid.svelte";
	import {
		currentEpisode,
		savedFeeds,
		episodeCache,
		latestEpisodes as latestEpisodesStore,
		playlists,
		queue,
		favorites,
		localFiles,
		podcastView,
		viewState,
		downloadedEpisodes,
		plugin,
	} from "src/store";
	import EpisodePlayer from "./EpisodePlayer.svelte";
	import EpisodeList from "./EpisodeList.svelte";
	import type { Episode } from "src/types/Episode";
	import FeedParser from "src/parser/feedParser";
	import TopBar from "./TopBar.svelte";
	import { ViewState } from "src/types/ViewState";
	import { onMount } from "svelte";
	import EpisodeListHeader from "./EpisodeListHeader.svelte";
	import Icon from "../obsidian/Icon.svelte";
	import { debounce } from "obsidian";
	import searchEpisodes from "src/utility/searchEpisodes";
	import type { Playlist } from "src/types/Playlist";
	import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
	import {
		getCachedEpisodes,
		getCachedEpisodesWithStatus,
		setCachedEpisodes,
	} from "src/services/FeedCacheService";
	import { get } from "svelte/store";

	let feeds: PodcastFeed[] = [];
	let selectedFeed: PodcastFeed | null = null;
	let selectedPlaylist: Playlist | null = null;
	let displayedEpisodes: Episode[] = [];
	let displayedPlaylists: Playlist[] = [];
	let latestEpisodes: Episode[] = [];
	const FEED_REFRESH_CONCURRENCY = 3;

	onMount(() => {
		const unsubscribePlaylists = playlists.subscribe((pl) => {
			displayedPlaylists = [$queue, $favorites, $localFiles, ...Object.values(pl)];
		});

		const unsubscribeSavedFeeds = savedFeeds.subscribe((storeValue) => {
			feeds = Object.values(storeValue);
			void hydrateAndRefreshFeeds();
		});

		const unsubscribeLatestEpisodes = latestEpisodesStore.subscribe(
			(episodes) => {
				latestEpisodes = episodes;

				if (!selectedFeed && !selectedPlaylist) {
					displayedEpisodes = episodes;
				}
			},
		);

		return () => {
			unsubscribeLatestEpisodes();
			unsubscribeSavedFeeds();
			unsubscribePlaylists();
		};
	});

	function getFeedCacheSettings() {
		const pluginInstance = get(plugin);
		const feedCacheSettings = pluginInstance?.settings?.feedCache;

		return {
			cacheEnabled: feedCacheSettings?.enabled !== false,
			cacheTtlMs:
				Math.max(1, feedCacheSettings?.ttlHours ?? 6) * 60 * 60 * 1000,
		};
	}

	async function fetchEpisodes(
		feed: PodcastFeed,
		useCache: boolean = true,
	): Promise<Episode[]> {
		const { cacheEnabled, cacheTtlMs } = getFeedCacheSettings();

		const cachedEpisodesInFeed = $episodeCache[feed.title];

		if (
			useCache &&
			cachedEpisodesInFeed &&
			cachedEpisodesInFeed.length > 0
		) {
			return cachedEpisodesInFeed;
		}

		if (useCache && cacheEnabled) {
			const persistedEpisodes = getCachedEpisodes(feed, cacheTtlMs);
			if (persistedEpisodes?.length) {
				episodeCache.update((cache) => ({
					...cache,
					[feed.title]: persistedEpisodes,
				}));
				return persistedEpisodes;
			}
		}

		try {
			const episodes = await new FeedParser(feed).getEpisodes(feed.url);

			episodeCache.update((cache) => ({
				...cache,
				[feed.title]: episodes,
			}));
			if (cacheEnabled) {
				setCachedEpisodes(feed, episodes);
			}

			return episodes;
		} catch (error) {
			console.error(
				`Failed to fetch episodes for ${feed.title}:`,
				error,
			);
			return $downloadedEpisodes[feed.title] || [];
		}
	}

	async function hydrateAndRefreshFeeds() {
		if (!feeds.length) {
			return;
		}

		const { cacheEnabled, cacheTtlMs } = getFeedCacheSettings();

		const cachedFeeds = cacheEnabled
			? feeds
					.map((feed) => {
						const cached = getCachedEpisodesWithStatus(feed, cacheTtlMs);
						if (!cached?.episodes.length) {
							return null;
						}

						return { feed, ...cached };
					})
					.filter(Boolean) as Array<{
						feed: PodcastFeed;
						episodes: Episode[];
						isExpired: boolean;
					}>
			: [];

		if (cachedFeeds.length) {
			episodeCache.update((cache) => {
				const updatedCache = { ...cache };

				for (const { feed, episodes } of cachedFeeds) {
					if (updatedCache[feed.title]?.length) {
						continue;
					}

					updatedCache[feed.title] = episodes;
				}

				return updatedCache;
			});

			if (!selectedFeed && !selectedPlaylist) {
				displayedEpisodes = latestEpisodes;
			}
		}

		const feedsToRefresh = cacheEnabled
			? feeds.filter((feed) => {
					const feedKey = feed.url ?? feed.title;
					const cached = cachedFeeds.find(
						({ feed: cachedFeed }) =>
							(cachedFeed.url ?? cachedFeed.title) === feedKey,
					);

					return !cached || cached.isExpired;
			  })
			: feeds;

		if (!feedsToRefresh.length) {
			if (!selectedFeed && !selectedPlaylist) {
				displayedEpisodes = latestEpisodes;
			}
			return;
		}

		void refreshFeedsWithLimit(feedsToRefresh);
	}

	async function refreshFeedsWithLimit(feedsToRefresh: PodcastFeed[]) {
		const queueToRefresh = [...feedsToRefresh];
		const workers = Array.from(
			{ length: FEED_REFRESH_CONCURRENCY },
			async () => {
				while (queueToRefresh.length) {
					const feed = queueToRefresh.shift();
					if (!feed) break;

					await fetchEpisodes(feed, false);
				}
			},
		);

		try {
			await Promise.all(workers);
		} catch (error) {
			console.error("Failed to refresh saved feeds:", error);
		} finally {
			if (!selectedFeed && !selectedPlaylist) {
				displayedEpisodes = latestEpisodes;
			}
		}
	}

	async function handleClickPodcast(
		event: CustomEvent<{ feed: PodcastFeed }>
	) {
		const { feed } = event.detail;
		displayedEpisodes = [];

		selectedFeed = feed;
		displayedEpisodes = await fetchEpisodes(feed);
		viewState.set(ViewState.EpisodeList);
	}

	function handleClickEpisode(event: CustomEvent<{ episode: Episode }>) {
		const { episode } = event.detail;
		currentEpisode.set(episode);

		viewState.set(ViewState.Player);
	}

	function handleContextMenuEpisode({
		detail: { event, episode },
	}: CustomEvent<{ episode: Episode; event: MouseEvent }>) {
		spawnEpisodeContextMenu(episode, event);
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

	function handleClickPlaylist(
		event: CustomEvent<{ event: MouseEvent; playlist: Playlist }>
	) {
		const { event: clickEvent, playlist } = event.detail;

		if (playlist.name === $queue.name && $queue.episodes.length > 0) {
			// Only need to set the current episode if there isn't any.
			// The current episode _is_ the front of the queue.
			if (!$currentEpisode) {
				currentEpisode.set($queue.episodes[0]);
			}

			viewState.set(ViewState.Player);
		} else {
			selectedPlaylist = playlist;
			displayedEpisodes = playlist.episodes;

			viewState.set(ViewState.EpisodeList);
		}
	}
</script>

<div class="podcast-view" bind:this={$podcastView}>
	<TopBar
		bind:viewState={$viewState}
		canShowEpisodeList={true}
		canShowPlayer={!!$currentEpisode}
	/>

	{#if $viewState === ViewState.Player}
		<EpisodePlayer />
	{:else if $viewState === ViewState.EpisodeList}
		<EpisodeList
			episodes={displayedEpisodes}
			showThumbnails={!selectedFeed || !selectedPlaylist}
			on:clickEpisode={handleClickEpisode}
			on:contextMenuEpisode={handleContextMenuEpisode}
			on:clickRefresh={handleClickRefresh}
			on:search={handleSearch}
		>
			<svelte:fragment slot="header">
				{#if selectedFeed}
					<button
						type="button"
						class="go-back"
						on:click={() => {
							selectedFeed = null;
							displayedEpisodes = latestEpisodes;
							viewState.set(ViewState.EpisodeList);
						}}
					>
						<Icon
							icon={"arrow-left"}
							size={20}
							clickable={false}
						/> Latest Episodes
					</button>
					<EpisodeListHeader
						text={selectedFeed.title}
						artworkUrl={selectedFeed.artworkUrl}
					/>
				{:else if selectedPlaylist}
					<button
						type="button"
						class="go-back"
						on:click={() => {
							selectedPlaylist = null;
							displayedEpisodes = latestEpisodes;
							viewState.set(ViewState.EpisodeList);
						}}
					>
						<Icon
							icon={"arrow-left"}
							size={20}
							clickable={false}
						/> Latest Episodes
					</button>
					<div class="playlist-header-icon">
						<Icon
							icon={selectedPlaylist.icon}
							size={40}
							clickable={false}
						/>
					</div>
					<EpisodeListHeader text={selectedPlaylist.name} />
				{:else}
					<EpisodeListHeader text="Latest Episodes" />
				{/if}
			</svelte:fragment>
		</EpisodeList>
	{:else if $viewState === ViewState.PodcastGrid}
		<PodcastGrid
			{feeds}
			playlists={displayedPlaylists}
			on:clickPodcast={handleClickPodcast}
			on:clickPlaylist={handleClickPlaylist}
		/>
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
		margin-right: auto;
		opacity: 0.75;
		cursor: pointer;
		background: none;
		border: none;
	}

	.go-back:hover {
		opacity: 1;
	}

	.playlist-header-icon {
		display: flex;
		align-items: center;
		justify-content: center;
	}
</style>
