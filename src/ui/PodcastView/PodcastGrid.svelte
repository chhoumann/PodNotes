<script lang="ts">
	import { PodcastFeed } from "src/types/PodcastFeed";
	import PodcastGridCard from "./PodcastGridCard.svelte";

	export let feeds: PodcastFeed[] = [];
</script>

<div class="podcast-grid">
	{#if feeds.length > 0}
		{#each feeds as feed}
			<PodcastGridCard
				feed={feed}
				on:clickPodcast
			/>
		{/each}
	{:else}
		<div>
			<p>No saved podcasts.</p>
		</div>
	{/if}
</div>

<style>
	.podcast-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		grid-gap: 0rem;
	}
</style>
