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
	import { selectFeedEpisodes } from "./episodeListSelection";
	import { shownFailure } from "./feedState";
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
	function failedSource({ error, feed }: FeedState): { text: string; host?: boolean } {
		if (error === "unavailable") return { text: "Address not on this device" };
		if (isPrivateFeedPlaceholder(feed.url)) return { text: "Private feed" };
		return { text: checkStringIsUrl(feed.url)?.host ?? "", host: true };
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
		{@const source = failedSource(feedState)}
		<div class="pn-banner" role="alert">
			<span class="pn-banner-icon" {@attach icon("alert-triangle")}></span>
			<div class="txt">
				<div class="h">Feed didn't load</div>
				<div class="d" class:is-host={source.host}>{source.text}</div>
			</div>
			{#if error === "unavailable"}
				<button
					type="button"
					class="pn-btn"
					disabled={!$online}
					onclick={() => actions.setFeedAddress(key)}
				>
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
		onclick={() => hidePlayedEpisodes.update((hidden) => !hidden)}
		{@attach icon("eye-off")}
	></button>
	<button
		type="button"
		class="pn-iconbtn"
		aria-label="Refresh episodes"
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

<style>
	.pn-hero {
		display: flex;
		align-items: center;
		gap: var(--size-4-3);
		margin: var(--size-2-2) 0 var(--size-4-2);
	}

	.pn-hero :global {
		.pn-cover {
			width: 64px;
			border-radius: 8px;
		}

		> div {
			min-width: 0;
		}

		/* A long title takes two lines and breaks anywhere. */
		h1 {
			margin: 0;
			font-size: var(--font-ui-medium);
			font-weight: var(--font-semibold);
			line-height: 1.3;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
			overflow-wrap: anywhere;
		}

		.by {
			margin-top: 2px;
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}

	.pn-banner {
		display: flex;
		align-items: flex-start;
		gap: var(--size-4-2);
		margin: var(--size-4-2) 0;
		padding: var(--size-4-2) var(--size-4-2) var(--size-4-2) var(--size-4-3);
		border: 1px solid rgba(var(--color-red-rgb), 0.25);
		border-radius: var(--radius-m);
		background: rgba(var(--color-red-rgb), 0.08);
	}

	.pn-banner :global {
		.pn-banner-icon {
			display: flex;
			margin-top: 6px;
			color: var(--text-error);
			--icon-size: var(--icon-s);
		}

		.txt {
			flex: 1;
			min-width: 0;
			padding-top: 5px;
		}

		.h {
			font-weight: var(--font-semibold);
		}

		.d {
			margin-top: 2px;
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
		}

		.d.is-host {
			font-family: var(--font-monospace);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}

	.pn-filter {
		position: sticky;
		top: 0;
		z-index: 2;
		display: flex;
		align-items: center;
		gap: var(--size-2-2);
		padding: var(--size-4-2) 0;
		margin-bottom: var(--size-2-2);
		background: var(--pn-bg);
	}

	:global(.is-wide) .pn-hero {
		gap: var(--size-4-5);
		margin: var(--size-4-2) 0 var(--size-4-3);
	}

	:global(.is-wide) .pn-hero :global {
		.pn-cover {
			width: 112px;
			border-radius: 10px;
		}

		h1 {
			font-size: var(--font-ui-large);
			line-height: 1.25;
			letter-spacing: -0.01em;
		}

		.by {
			margin-top: var(--size-4-1);
			font-size: var(--font-ui-small);
		}
	}

	:global(.is-phone) .pn-hero :global(.pn-cover) {
		width: 76px;
	}
</style>
