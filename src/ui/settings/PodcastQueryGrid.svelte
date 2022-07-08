<script lang="ts">
    import { debounce, TextComponent } from "obsidian";
    import { consume } from "src/iTunesAPIConsumer";
    import { savedFeeds } from "src/store";
    import { PodcastFeed } from "src/types/PodcastFeed";
    import { onMount } from "svelte";
    import PodcastResultCard from "./PodcastResultCard.svelte";

    let inputRef: HTMLSpanElement;
    let searchResults: PodcastFeed[] = [];

    let gridSizeClass: string = "grid-3";

	if (searchResults.length % 3 === 0 || searchResults.length > 3) {
		gridSizeClass = "grid-3";
	} else if (searchResults.length % 2 === 0) {
		gridSizeClass = "grid-2";
	} else if (searchResults.length % 1 === 0) {
		gridSizeClass = "grid-1";
	}

    onMount(() => {
        const debouncedUpdate = debounce(async (value: string) => {
            searchResults = await (await consume(value)).filter(
                (feed: PodcastFeed) => !$savedFeeds[feed.title]
            );
        }, 300, true);

        const textInput = new TextComponent(inputRef)
            .setPlaceholder("Search...")
            .onChange(debouncedUpdate)
    
        textInput.inputEl.style.width = "100%";
        textInput.inputEl.style.marginBottom = "1rem";
    });

    function addPodcast(event: CustomEvent<{ podcast: PodcastFeed }>) {
        const { podcast } = event.detail;

        savedFeeds.update(feeds => ({ ...feeds, [podcast.title]: podcast }));
    }
</script>

<div class="podcast-query-container">
    <h3 class="podcast-query-heading">Search for a podcast</h3>
    <span bind:this={inputRef} />

    <div 
        class={`
            podcast-query-results
            ${gridSizeClass}
        `}
    >
        {#each searchResults as podcast}
            <PodcastResultCard 
                podcast={podcast} 
                on:addPodcast={addPodcast}    
            />
        {/each}
    </div>
</div>

<style>
    .podcast-query-container {
        margin-bottom: 2rem;
    }

    .podcast-query-heading {
        margin-bottom: 0.5rem;
    }

    .podcast-query-results {
        width: 100%;
        height: 100%;
        display: grid;
        grid-gap: 1rem;
    }

    .grid-3 {
        grid-template-columns: repeat(3, 1fr);
    }

    .grid-2 {
        grid-template-columns: repeat(2, 1fr);
    }

    .grid-1 {
        grid-template-columns: repeat(1, 1fr);
    }
</style>