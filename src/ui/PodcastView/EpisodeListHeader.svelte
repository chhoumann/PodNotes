<script lang="ts">
    export let text: string = "";
    export let artworkUrl: string = "";
</script>

<div class="podcast-header">
    {#if artworkUrl}
        <img id="podcast-artwork" src={artworkUrl} alt={text} />
    {/if}
    <h2 class="podcast-heading">{text}</h2>
</div>

<style>
	.podcast-header {
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: center;
		gap: 0.75rem;
		padding: 1rem;
	}

	#podcast-artwork {
		width: 5rem;
		height: 5rem;
		border-radius: 0.5rem;
		object-fit: cover;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
	}

	.podcast-heading {
		margin: 0;
		font-size: 1.125rem;
		font-weight: 600;
		text-align: center;
		color: var(--text-normal);
	}
</style>