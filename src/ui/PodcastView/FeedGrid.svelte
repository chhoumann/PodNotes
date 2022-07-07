<script lang="ts">
    import { PodcastFeed } from "src/types/PodcastFeed";
	import { createEventDispatcher } from "svelte";

    export let feeds: PodcastFeed[] = [];

	const dispatcher = createEventDispatcher();

	function onClickFeed(feed: PodcastFeed) {
		dispatcher("clickFeed", { feed });
	}
</script>

<div class="feed-grid grid-3">
    {#if feeds.length > 0}
        {#each feeds as feed}
            <img 
                id={feed.title}
                src={feed.artworkUrl} 
                alt={feed.title} 
                on:click={onClickFeed.bind(null, feed)} 
                class="feed-image"
            />
        {/each}
    {:else}
        <div class="no-feeds">
            <p>No feeds found</p>
        </div>
    {/if}
</div>

<style>
    .feed-image {
        width: 100%;
        cursor: pointer !important;
    }

    .feed-grid {
        grid-gap: 0rem;
    }
</style>