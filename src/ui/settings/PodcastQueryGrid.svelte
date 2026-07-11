<script lang="ts">
	import { debounce, Notice } from "obsidian";
	import { queryiTunesPodcasts } from "src/iTunesAPIConsumer";
	import FeedParser from "src/parser/feedParser";
	import { plugin, savedFeeds, podcastsUpdated } from "src/store";
	import { get } from "svelte/store";
	import { internPrivateFeed } from "src/services/privateFeeds";
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import checkStringIsUrl from "src/utility/checkStringIsUrl";
	import Text from "../obsidian/Text.svelte";
	import PodcastResultCard from "./PodcastResultCard.svelte";
	import { onMount } from "svelte";
	import { fade } from "svelte/transition";

	let searchResults: PodcastFeed[] = [];
	let gridSizeClass: string = "grid-3";
	let searchQuery: string = "";
	let isSearching: boolean = false;
	let searchError: string = "";

	let searchInput: HTMLInputElement;

	onMount(() => {
		// Initialize searchResults with saved podcasts
		updateSearchResults();
		if (searchInput) {
			searchInput.focus();
		}
	});

	$: {
		if (searchResults.length % 3 === 0 || searchResults.length > 3) {
			gridSizeClass = "grid-3";
		} else if (searchResults.length % 2 === 0) {
			gridSizeClass = "grid-2";
		} else if (searchResults.length % 1 === 0) {
			gridSizeClass = "grid-1";
		}
	}

	$: {
		// This will run whenever savedFeeds or podcastsUpdated changes
		if (searchQuery.trim() === "") {
			searchResults = Object.values($savedFeeds);
		}
		$podcastsUpdated; // This ensures the block runs when podcastsUpdated changes
	}

	function updateSearchResults() {
		if (searchQuery.trim() === "") {
			// If search query is empty, show all saved podcasts
			searchResults = Object.values($savedFeeds);
		}
	}

	const debouncedUpdate = debounce(
		async ({ detail: { value } }: CustomEvent<{ value: string }>) => {
			searchQuery = value;
			searchError = "";
			const customFeedUrl = checkStringIsUrl(value);

			// Only treat the input as a feed URL when it is an http(s) URL, so
			// things like "podcast:name" don't get parsed as feeds.
			const isFeedUrl =
				customFeedUrl?.protocol === "http:" || customFeedUrl?.protocol === "https:";

			if (isFeedUrl && customFeedUrl) {
				isSearching = true;
				try {
					const feed = await new FeedParser().getFeed(customFeedUrl.href);
					searchResults = [feed];
				} catch (e) {
					searchResults = [];
					const msg = e instanceof Error ? e.message : String(e);
					searchError = `Could not load feed: ${msg}`;
					new Notice(searchError);
				} finally {
					isSearching = false;
				}
			} else if (value.trim() === "") {
				updateSearchResults();
			} else {
				isSearching = true;
				try {
					searchResults = await queryiTunesPodcasts(value);
				} catch (e) {
					searchResults = [];
					searchError = "Could not search podcasts. Please try again.";
				} finally {
					isSearching = false;
				}
			}
		},
		300,
		true,
	);

	function addPodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
		// A pasted private feed URL must never reach persisted settings: intern it
		// into SecretStorage and save the placeholder + reference instead.
		const podcast = internPrivateFeed(event.detail.podcast, get(plugin).feedUrls);
		savedFeeds.update((feeds) => ({ ...feeds, [podcast.title]: podcast }));
		updateSearchResults();
	}

	function removePodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
		const { podcast } = event.detail;
		savedFeeds.update((feeds) => {
			const removed = feeds[podcast.title];
			if (removed?.urlSecretId) get(plugin).feedUrls.delete(removed.urlSecretId);
			const newFeeds = { ...feeds };
			delete newFeeds[podcast.title];
			return newFeeds;
		});
		updateSearchResults();
	}
</script>

<div class="podcast-query-container" transition:fade={{ duration: 300 }}>
	<Text
		placeholder="Search or enter feed URL..."
		on:change={debouncedUpdate}
		style={{
			width: "100%",
			"margin-bottom": "1rem",
		}}
		bind:el={searchInput}
	/>

	{#if isSearching}
		<div class="podcast-query-status" role="status" aria-live="polite">Searching...</div>
	{:else if searchError}
		<div class="podcast-query-status podcast-query-error" role="alert">
			{searchError}
		</div>
	{:else if searchQuery.trim() !== "" && searchResults.length === 0}
		<div class="podcast-query-status" role="status" aria-live="polite">No results.</div>
	{/if}

	<div class="podcast-query-results" role="list" aria-label="Podcast search results">
		{#each searchResults as podcast (podcast.url)}
			<div role="listitem">
				<PodcastResultCard
					{podcast}
					isSaved={typeof podcast.url === "string" &&
						$savedFeeds[podcast.title]?.url === podcast.url}
					on:addPodcast={addPodcast}
					on:removePodcast={removePodcast}
				/>
			</div>
		{/each}
	</div>
</div>

<style>
	.podcast-query-container {
		margin-bottom: 1.5rem;
	}

	.podcast-query-status {
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.podcast-query-error {
		color: var(--text-error);
	}

	.podcast-query-results {
		display: grid;
		gap: 0.75rem;
		grid-template-columns: 1fr;
	}

	@media (min-width: 500px) {
		.podcast-query-results {
			grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
		}
	}
</style>
