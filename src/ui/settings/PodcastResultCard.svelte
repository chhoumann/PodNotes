<script lang="ts">
    import { PodcastFeed } from "src/types/PodcastFeed";
    import { createEventDispatcher } from "svelte";
import Button from "../obsidian/Button.svelte";

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
        <img style="width: 100%;" src={podcast.artworkUrl} alt={podcast.title} />
    </div>
    
    <h4 class="podcast-query-heading">{podcast.title}</h4>

    <div class="podcast-query-button-container">
        <Button
            text={isSaved ? "Remove" : "Add"}
            warning={isSaved}
            on:click={isSaved ? onClickRemovePodcast : onClickAddPodcast}
            style={{"cursor": "pointer"}}
        />
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
</style>
