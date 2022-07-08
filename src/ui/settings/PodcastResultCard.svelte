<script lang="ts">
    import { PodcastFeed } from "src/types/PodcastFeed";
    import { createEventDispatcher } from "svelte";

    export let podcast: PodcastFeed;
    let wasAdded: boolean = false;

    const dispatch = createEventDispatcher();

    function onClickAddPodcast() {
        dispatch("addPodcast", { podcast });
        wasAdded = true;
    }

</script>

<div class="podcast-query-card">
    <div class="podcast-query-image-container">
        <img src={podcast.artworkUrl} alt={podcast.title} />
    </div>
    
    <h4 class="podcast-query-heading">{podcast.title}</h4>

    <button 
        class="podcast-query-button" 
        disabled={wasAdded}
        on:click={onClickAddPodcast}
    >
        {wasAdded ? "Added" : "Add"}
    </button>
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

    .podcast-query-button {
        margin-top: auto;
    }
</style>