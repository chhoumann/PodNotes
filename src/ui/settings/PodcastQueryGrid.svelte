<script lang="ts">
import { debounce } from "obsidian";
import { queryiTunesPodcasts } from "src/iTunesAPIConsumer";
import FeedParser from "src/parser/feedParser";
import { podcastsUpdated, savedFeeds } from "src/store";
import type { PodcastFeed } from "src/types/PodcastFeed";
import checkStringIsUrl from "src/utility/checkStringIsUrl";
import { onMount } from "svelte";
import { fade } from "svelte/transition";
import Text from "../obsidian/Text.svelte";
import PodcastResultCard from "./PodcastResultCard.svelte";

let searchResults: PodcastFeed[] = [];
let gridSizeClass = "grid-3";
let searchQuery = "";

let searchInput: HTMLInputElement;

onMount(() => {
	// Initialize searchResults with saved podcasts
	updateSearchResults();
	if (searchInput) {
		searchInput.focus();
	}

	const unsubscribe = podcastsUpdated.subscribe((value) => {
		podcastsUpdatedValue = value;
	});

	return () => {
		unsubscribe();
	};
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

let podcastsUpdatedValue = 0;

$: {
	// This will run whenever savedFeeds or podcastsUpdated changes
	if (searchQuery.trim() === "") {
		searchResults = Object.values($savedFeeds);
	}
	podcastsUpdatedValue; // This ensures the block runs when podcastsUpdated changes
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
		const customFeedUrl = checkStringIsUrl(value);

		if (customFeedUrl) {
			const feed = await new FeedParser().getFeed(customFeedUrl.href);
			searchResults = [feed];
		} else if (value.trim() === "") {
			updateSearchResults();
		} else {
			searchResults = await queryiTunesPodcasts(value);
		}
	},
	300,
	true,
);

function addPodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
	const { podcast } = event.detail;
	savedFeeds.update((feeds) => ({ ...feeds, [podcast.title]: podcast }));
	updateSearchResults();
}

function removePodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
	const { podcast } = event.detail;
	savedFeeds.update((feeds) => {
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

	<div class="podcast-query-results" role="list" aria-label="Podcast search results">
		{#each searchResults as podcast (podcast.url)}
			<div role="listitem">
				<PodcastResultCard
					{podcast}
					isSaved={typeof podcast.url === "string" && $savedFeeds[podcast.title]?.url === podcast.url}
					on:addPodcast={addPodcast}
					on:removePodcast={removePodcast}
				/>
			</div>
		{/each}
	</div>
</div>

<style>
	.podcast-query-container {
		margin-bottom: 2rem;
	}

	.podcast-query-results {
		display: grid;
		grid-gap: 16px;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	}

	@media (max-width: 600px) {
		.podcast-query-results {
			grid-template-columns: 1fr;
		}
	}
</style>