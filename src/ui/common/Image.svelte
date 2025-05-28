<script lang="ts">
	import { createEventDispatcher } from "svelte";
	import { onMount } from "svelte";

	export let src: string;
	export let alt: string;
	export let loading: 'lazy' | 'eager' = 'eager';
	export let fadeIn: boolean = false;
	export let opacity: number = 1;
	export {_class as class};
	let _class = "";

	let imageElement: HTMLImageElement;
	let loaded = false;
	let failed = false;
	let isIntersecting = false;

	const dispatcher = createEventDispatcher();

	// Intersection Observer for truly lazy loading
	onMount(() => {
		if (loading === 'lazy' && 'IntersectionObserver' in window) {
			const observer = new IntersectionObserver(
				(entries) => {
					entries.forEach(entry => {
						if (entry.isIntersecting) {
							isIntersecting = true;
							observer.unobserve(entry.target);
						}
					});
				},
				{
					rootMargin: '50px' // Start loading 50px before visible
				}
			);

			if (imageElement) {
				observer.observe(imageElement);
			}

			return () => {
				observer.disconnect();
			};
		} else {
			// If no IntersectionObserver or eager loading, load immediately
			isIntersecting = true;
		}
	});

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

	// Compute final src based on intersection
	$: finalSrc = (loading === 'lazy' && !isIntersecting) ? '' : src;
</script>

{#if !failed}
	<img
		bind:this={imageElement}
		on:click={handleClick}
		on:load={handleLoad}
		on:error={handleError}
		src={finalSrc}
		{alt}
		{loading}
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