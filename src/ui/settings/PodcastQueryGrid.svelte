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
		findSavedFeed,
		internPrivateFeed,
		needsPrivateFeedAddress,
		notifyPrivateFeedUnavailable,
		resolveFeedUrl,
		setPrivateFeedAddress,
	} from "src/services/privateFeeds";
	import type { PodcastFeed } from "src/types/PodcastFeed";
	import checkStringIsUrl from "src/utility/checkStringIsUrl";
	import { isCredentialBearingUrl } from "src/utility/privateFeedUrl";
	import Text from "../obsidian/Text.svelte";
	import { askFeedAddress } from "./FeedAddressModal";
	import PodcastResultCard from "./PodcastResultCard.svelte";
	import { onMount } from "svelte";
	import { fade } from "svelte/transition";

	// Saved podcasts carry their savedFeeds key; search results have none.
	let searchResults: [key: string | undefined, podcast: PodcastFeed][] = [];
	const unsaved = (podcast: PodcastFeed): [undefined, PodcastFeed] => [undefined, podcast];
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
		if (searchQuery.trim() === "") {
			searchResults = Object.entries($savedFeeds);
		}
	}

	function updateSearchResults() {
		if (searchQuery.trim() === "") {
			// If search query is empty, show all saved podcasts
			searchResults = Object.entries($savedFeeds);
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
						searchResults = [unsaved(feed)];
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
					const feed = await get(plugin).feeds.channelAt({ url: customFeedUrl.href });
					if (input !== latestInput) return;
					searchResults = [unsaved(feed)];
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
					searchResults = results.map(unsaved);
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
	function savedFeedAt(feeds: Record<string, PodcastFeed>, key: string): PodcastFeed | undefined {
		return Object.prototype.hasOwnProperty.call(feeds, key) ? feeds[key] : undefined;
	}

	// Saved private feeds whose URL is not on this device. SecretStorage is not a
	// store, so setting an address here recomputes it.
	let missingAddresses = new Set<string>();
	$: missingAddresses = feedsMissingAddress($savedFeeds);

	function feedsMissingAddress(feeds: Record<string, PodcastFeed>): Set<string> {
		const { feedUrls } = get(plugin);
		return new Set(
			Object.keys(feeds).filter((key) => needsPrivateFeedAddress(feeds[key], feedUrls)),
		);
	}

	function notStored(title: string, error: unknown) {
		console.error("PodNotes: could not store a private feed URL", error);
		new Notice(`Could not store the private feed address for "${title}" on this device.`);
	}

	function addPodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
		const { podcast } = event.detail;
		const { feedUrls } = get(plugin);
		if (findSavedFeed($savedFeeds, podcast.url, feedUrls) !== undefined) return;
		// A namesake must never replace a saved feed. A saved private feed whose
		// URL is missing on this device cannot be compared, so say that instead.
		const saved = savedFeedAt($savedFeeds, podcast.title);
		if (saved) {
			if (resolveFeedUrl(saved, feedUrls) === null) {
				notifyPrivateFeedUnavailable(saved.title);
				return;
			}
			new Notice(`You already follow a podcast called ${podcast.title} from another feed.`);
			return;
		}
		// A pasted private feed URL must never reach persisted settings: intern it
		// into SecretStorage and save the placeholder + reference instead.
		let feed: PodcastFeed;
		try {
			feed = internPrivateFeed(podcast, feedUrls);
		} catch (error) {
			notStored(podcast.title, error);
			return;
		}
		savedFeeds.update((feeds) => ({ ...feeds, [feed.title]: feed }));
		updateSearchResults();
	}

	async function setFeedAddress(key: string) {
		const feed = savedFeedAt(get(savedFeeds), key);
		if (!feed) return;
		const { app, feeds, feedUrls } = get(plugin);
		const entered = await askFeedAddress(app, feed.title);
		if (entered === null || entered.trim() === "") return;
		const url = checkStringIsUrl(entered.trim());
		if (url?.protocol !== "http:" && url?.protocol !== "https:") {
			new Notice("Enter the feed's http or https address.");
			return;
		}
		if (!isCredentialBearingUrl(url.href)) {
			new Notice("Enter a private feed address.");
			return;
		}
		try {
			await feeds.channelAt({ url: url.href });
		} catch (e) {
			new Notice(`Could not load feed: ${e instanceof Error ? e.message : String(e)}`);
			return;
		}
		const current = savedFeedAt(get(savedFeeds), key);
		if (!current || current.urlSecretId !== feed.urlSecretId) return;
		try {
			setPrivateFeedAddress(current, url.href, feedUrls);
		} catch (error) {
			notStored(feed.title, error);
			return;
		}
		missingAddresses = feedsMissingAddress(get(savedFeeds));
		void feeds.load([key], "network");
	}

	function removePodcast(key: string) {
		savedFeeds.update((feeds) => {
			const removed = feeds[key];
			const newFeeds = { ...feeds };
			delete newFeeds[key];
			const reference = removed?.urlSecretId?.trim();
			const stillReferenced = Object.values(newFeeds).some(
				(feed) => feed.urlSecretId?.trim() === reference,
			);
			if (reference && !stillReferenced) {
				get(plugin).feedUrls.delete(reference);
			}
			return newFeeds;
		});
		updateSearchResults();
	}
</script>

<div class="podcast-query-container" in:fade={{ duration: 300 }}>
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
		{#each searchResults as [key, podcast] (key ?? podcast)}
			{@const savedKey = key ?? findSavedFeed($savedFeeds, podcast.url, $plugin.feedUrls)}
			<div role="listitem">
				<PodcastResultCard
					{podcast}
					isSaved={savedKey !== undefined}
					needsAddress={savedKey !== undefined && missingAddresses.has(savedKey)}
					on:addPodcast={addPodcast}
					on:removePodcast={() => savedKey !== undefined && removePodcast(savedKey)}
					on:setFeedAddress={() => savedKey !== undefined && setFeedAddress(savedKey)}
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
