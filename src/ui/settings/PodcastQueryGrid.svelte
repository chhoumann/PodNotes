<script lang="ts">
	import { debounce, Notice } from "obsidian";
	import {
		lookupiTunesPodcast,
		parseApplePodcastsId,
		queryiTunesPodcasts,
	} from "src/iTunesAPIConsumer";
	import { plugin, savedFeeds } from "src/store";
	import { get } from "svelte/store";
	import {
		internPrivateFeed,
		isSavedFeed,
		resolveFeedUrlWithNotice,
	} from "src/services/privateFeeds";
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
	// Responses can arrive out of order; only the latest input may change the grid.
	let latestInput = 0;

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
		if (searchQuery.trim() === "") {
			searchResults = Object.values($savedFeeds);
		}
	}

	function updateSearchResults() {
		if (searchQuery.trim() === "") {
			// If search query is empty, show all saved podcasts
			searchResults = Object.values($savedFeeds);
		}
	}

	const debouncedUpdate = debounce(
		async (value: string, input: number) => {
			searchQuery = value;
			searchError = "";
			const applePodcastsId = parseApplePodcastsId(value);
			const customFeedUrl = checkStringIsUrl(value);

			// Only treat the input as a feed URL when it is an http(s) URL, so
			// things like "podcast:name" don't get parsed as feeds.
			const isFeedUrl =
				customFeedUrl?.protocol === "http:" || customFeedUrl?.protocol === "https:";

			if (applePodcastsId) {
				isSearching = true;
				try {
					const feed = await lookupiTunesPodcast(applePodcastsId);
					if (input !== latestInput) return;
					if (feed) {
						searchResults = [feed];
					} else {
						searchResults = [];
						searchError = "No public RSS feed found for this Apple Podcasts link.";
						new Notice(searchError);
					}
				} catch {
					if (input !== latestInput) return;
					searchResults = [];
					searchError = "Could not look up this Apple Podcasts link. Please try again.";
					new Notice(searchError);
				} finally {
					if (input === latestInput) isSearching = false;
				}
			} else if (isFeedUrl && customFeedUrl) {
				isSearching = true;
				try {
					const feed = await get(plugin).feeds.channelAt(customFeedUrl.href);
					if (input !== latestInput) return;
					searchResults = [feed];
				} catch (e) {
					if (input !== latestInput) return;
					searchResults = [];
					const msg = e instanceof Error ? e.message : String(e);
					searchError = `Could not load feed: ${msg}`;
					new Notice(searchError);
				} finally {
					if (input === latestInput) isSearching = false;
				}
			} else if (value.trim() === "") {
				isSearching = false;
				updateSearchResults();
			} else {
				isSearching = true;
				try {
					const results = await queryiTunesPodcasts(value);
					if (input !== latestInput) return;
					searchResults = results;
				} catch (e) {
					if (input !== latestInput) return;
					searchResults = [];
					searchError = "Could not search podcasts. Please try again.";
				} finally {
					if (input === latestInput) isSearching = false;
				}
			}
		},
		300,
		true,
	);

	// Saved feeds are keyed by title. Only own keys count, so a show called
	// "toString" is not mistaken for a saved one.
	function savedFeedTitled(
		feeds: Record<string, PodcastFeed>,
		title: string,
	): PodcastFeed | undefined {
		return Object.prototype.hasOwnProperty.call(feeds, title) ? feeds[title] : undefined;
	}

	// A saved row is the saved feed itself, so a shared URL or a key that differs
	// from the title still finds its own entry.
	function savedKey(
		feeds: Record<string, PodcastFeed>,
		podcast: PodcastFeed,
	): string | undefined {
		return Object.keys(feeds).find((key) => feeds[key] === podcast);
	}

	function isSavedResult(feeds: Record<string, PodcastFeed>, podcast: PodcastFeed): boolean {
		const saved = savedFeedTitled(feeds, podcast.title);
		return saved !== undefined && isSavedFeed(saved, podcast.url, get(plugin).feedUrls);
	}

	function addPodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
		const { podcast } = event.detail;
		const { feedUrls } = get(plugin);
		// A namesake must never replace a saved feed. A saved private feed whose
		// URL is missing on this device cannot be compared, so say that instead.
		const saved = savedFeedTitled($savedFeeds, podcast.title);
		if (saved) {
			if (isSavedFeed(saved, podcast.url, feedUrls)) return;
			if (resolveFeedUrlWithNotice(saved, feedUrls) === null) return;
			new Notice(`You already follow a podcast called ${podcast.title} from another feed.`);
			return;
		}
		// A pasted private feed URL must never reach persisted settings: intern it
		// into SecretStorage and save the placeholder + reference instead.
		const feed = internPrivateFeed(podcast, feedUrls);
		savedFeeds.update((feeds) => ({ ...feeds, [feed.title]: feed }));
		updateSearchResults();
	}

	function removePodcast(key: string) {
		savedFeeds.update((feeds) => {
			const removed = feeds[key];
			const newFeeds = { ...feeds };
			delete newFeeds[key];
			// Identical private URLs dedupe to one secret ID, so delete only when no
			// remaining feed still references it (the load-time sweep is the backstop).
			const stillReferenced = Object.values(newFeeds).some(
				(feed) => feed.urlSecretId === removed?.urlSecretId,
			);
			if (removed?.urlSecretId && !stillReferenced) {
				get(plugin).feedUrls.delete(removed.urlSecretId);
			}
			return newFeeds;
		});
		updateSearchResults();
	}
</script>

<div class="podcast-query-container" transition:fade={{ duration: 300 }}>
	<Text
		placeholder="Search or enter feed URL..."
		on:change={(e) => debouncedUpdate(e.detail.value, ++latestInput)}
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
		{#each searchResults as podcast (podcast)}
			<div role="listitem">
				<PodcastResultCard
					{podcast}
					isSaved={savedKey($savedFeeds, podcast) !== undefined ||
						isSavedResult($savedFeeds, podcast)}
					on:addPodcast={addPodcast}
					on:removePodcast={() =>
						removePodcast(savedKey($savedFeeds, podcast) ?? podcast.title)}
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
