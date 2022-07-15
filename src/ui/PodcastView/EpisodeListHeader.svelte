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
		justify-content: space-around;
		align-items: center;
		padding: 0.5rem;
	}

	.podcast-heading {
		text-align: center;
	}
</style>