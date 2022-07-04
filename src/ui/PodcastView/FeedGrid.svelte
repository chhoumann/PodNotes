<script lang="ts">
    import { PodcastFeed } from "src/types/PodcastFeed";

    export let feeds: PodcastFeed[] = [];
    export let onClickFeed: (feed: PodcastFeed) => void;
</script>

<div class="feed-grid grid-3">
    {#if feeds.length > 0}
        {#each feeds as feed}
            <img 
                id={feed.title}
                src={feed.artworkUrl} 
                alt={feed.title} 
                on:click={() => onClickFeed(feed)} 
                class="feed-image"
            />
        {/each}
    {:else}
        <div class="no-feeds">
            <p>No feeds found</p>
        </div>
    {/if}
</div>

