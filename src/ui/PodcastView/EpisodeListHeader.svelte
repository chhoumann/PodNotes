<script lang="ts">
    export let text: string = "";
    export let artworkUrl: string = "";
</script>

<div class="podcast-header" class:podcast-header-with-artwork={artworkUrl}>
    {#if artworkUrl}
        <img id="podcast-artwork" src={artworkUrl} alt={text} />
    {/if}
    <h2 class="podcast-heading">{text}</h2>
</div>

<style>
	.podcast-header {
		display: flex;
		flex-direction: row;
		justify-content: flex-start;
		align-items: center;
		gap: 0.75rem;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	#podcast-artwork {
		flex: 0 0 3.25rem;
		width: 3.25rem;
		height: 3.25rem;
		border-radius: 0.5rem;
		object-fit: cover;
	}

	.podcast-heading {
		margin: 0;
		font-size: 1rem;
		font-weight: 600;
		line-height: 1.25;
		text-align: left;
		color: var(--text-normal);
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.podcast-header:not(.podcast-header-with-artwork) {
		justify-content: center;
		padding: 0.875rem 1rem;
	}
</style>
