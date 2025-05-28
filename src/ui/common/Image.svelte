<script lang="ts">
	import { createEventDispatcher } from "svelte";

	export let src: string;
	export let alt: string;
	export let fadeIn: boolean = false;
	export let opacity: number = 1;
	export {_class as class};
	let _class = "";

	let loaded = false;
	let failed = false;

	const dispatcher = createEventDispatcher();

	function handleClick(event: MouseEvent) {
		dispatcher("click", { event });
	}

	function handleLoad() {
		loaded = true;
	}

	function handleError() {
		failed = true;
		dispatcher("error");
	}
</script>

{#if !failed}
	<img
		on:click={handleClick}
		on:load={handleLoad}
		on:error={handleError}
		{src}
		{alt}
		class={_class}
		draggable="false"
		style:opacity={fadeIn && !loaded ? 0 : opacity}
		style:transition={fadeIn ? "opacity 0.2s ease-out" : "none"}
	/>
{:else}
	<slot name="fallback">
		<div class="image-error">Failed to load image</div>
	</slot>
{/if}

<style>
	img {
		display: block;
		max-width: 100%;
		height: auto;
	}

	.image-error {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		background: var(--background-secondary);
		color: var(--text-muted);
		font-size: 0.8em;
		text-align: center;
		padding: 1rem;
	}
</style>