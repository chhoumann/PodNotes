<script lang="ts">
    import { PodcastFeed } from "src/types/PodcastFeed";
    import { createEventDispatcher } from "svelte";
    import Button from "../obsidian/Button.svelte";
    import { fade, fly } from 'svelte/transition';

    export let podcast: PodcastFeed;
    export let isSaved: boolean = false;

    const dispatch = createEventDispatcher();

    function onAddPodcast() {
        dispatch("addPodcast", { podcast });
    }

    function onRemovePodcast() {
        dispatch("removePodcast", { podcast });
    }
</script>

<div class="podcast-result-card" transition:fade={{ duration: 300 }}>
    <img
        src={podcast.artworkUrl}
        alt={`Artwork for ${podcast.title}`}
        class="podcast-artwork"
    />
    <div class="podcast-info">
        <h3 class="podcast-title">{podcast.title}</h3>
    </div>
    <div class="podcast-actions">
        {#if isSaved}
            <Button
                icon="trash"
                ariaLabel={`Remove ${podcast.title} podcast`}
                on:click={onRemovePodcast}
            />
        {:else}
            <Button
                icon="plus"
                ariaLabel={`Add ${podcast.title} podcast`}
                on:click={onAddPodcast}
            />
        {/if}
    </div>
</div>

<style>
    .podcast-result-card {
        display: flex;
        align-items: center;
        padding: 16px;
        border: 1px solid var(--background-modifier-border);
        border-radius: 8px;
        background-color: var(--background-secondary);
        max-width: 100%;
        transition: all 0.3s ease;
    }

    .podcast-result-card:hover {
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        transform: translateY(-2px);
    }

    .podcast-artwork {
        width: 70px;
        height: 70px;
        object-fit: cover;
        border-radius: 4px;
        margin-right: 20px;
        flex-shrink: 0;
    }

    .podcast-info {
        flex-grow: 1;
        min-width: 0;
        padding-right: 12px;
    }

    .podcast-title {
        margin: 0 0 6px 12px;
        font-size: 16px;
        font-weight: bold;
        line-height: 1.3;
        word-break: break-word;
    }

    .podcast-actions {
        display: flex;
        align-items: center;
        flex-shrink: 0;
    }
</style>