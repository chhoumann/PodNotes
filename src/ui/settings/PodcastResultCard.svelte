<script lang="ts">
    import { PodcastFeed } from "src/types/PodcastFeed";
    import { createEventDispatcher } from "svelte";

    export let podcast: PodcastFeed;
    export let isSaved: boolean = false;

    const dispatch = createEventDispatcher();

    function onClickAddPodcast() {
        dispatch("addPodcast", { podcast });
    }

    function onClickRemovePodcast() {
        dispatch("removePodcast", { podcast });
    }
</script>

<div class="podcast-query-card">
    <div class="podcast-query-image-container">
        <img src={podcast.artworkUrl} alt={podcast.title} />
    </div>
    
    <h4 class="podcast-query-heading">{podcast.title}</h4>

    <div class="podcast-query-button-container">
        <button 
            class={`${isSaved && "mod-warning"} podcast-query-button`}
            on:click={isSaved ? onClickRemovePodcast : onClickAddPodcast}
        >
            {isSaved ? "Remove" : "Add"}
        </button>
    </div>
</div>

<style>
    .podcast-query-card {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100%;
    }

    .podcast-query-image-container {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .podcast-query-heading {
        text-align: center;
    }

    .podcast-query-button-container {
        margin-top: auto;
    }

    .podcast-query-button {
        cursor: pointer !important;
    }
</style>