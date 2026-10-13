<script lang="ts">
	/** Artwork, or the title on a plain tile when there is none or it fails to load. */
	let { src, title }: { src: string | undefined; title: string } = $props();
	let failed = $state<string>();
</script>

{#if src && src !== failed}
	<img
		class="pn-cover"
		{src}
		alt=""
		loading="lazy"
		draggable="false"
		onerror={() => (failed = src)}
	/>
{:else}
	<span class="pn-cover is-text" aria-hidden="true"><span>{title}</span></span>
{/if}
