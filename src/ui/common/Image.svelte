<script lang="ts">
	import { createEventDispatcher } from "svelte";

	export let src: string;
	export let alt: string;
	export let fadeIn: boolean = false;
	export let opacity: number = 0; // Falsey value so condition isn't triggered if not set.
	export let interactive: boolean = false;
	export let loading: "lazy" | "eager" | null | undefined = "lazy";
	export {_class as class};
	let _class = "";

	let loaded = false;
	let isLoading = true;
	let failed = false;

	const dispatcher = createEventDispatcher();

	function onClick(event: MouseEvent) {
		dispatcher("click", { event });
	}
</script>

{#if isLoading || loaded}
	{#if interactive}
		<button
			type="button"
			class="pn_image_container"
			on:click={onClick}
		>
			<img 
				draggable="false"
				{src} 
				{alt} 
				{loading}
				class={_class}
				style:opacity={opacity ? opacity : !fadeIn ? 1 : loaded ? 1 : 0}
				style:transition={fadeIn ? "opacity 0.5s ease-out" : ""}
				on:load={() => {loaded = true; isLoading = false;}}
				on:error={() => {failed = true; isLoading = false;}}
			/>
		</button>
	{:else}
		<div class="pn_image_container pn_image_container--static">
			<img 
				draggable="false"
				{src} 
				{alt} 
				{loading}
				class={_class}
				style:opacity={opacity ? opacity : !fadeIn ? 1 : loaded ? 1 : 0}
				style:transition={fadeIn ? "opacity 0.5s ease-out" : ""}
				on:load={() => {loaded = true; isLoading = false;}}
				on:error={() => {failed = true; isLoading = false;}}
			/>
		</div>
	{/if}
{:else if failed}
	<slot name="fallback" />
{/if}

<style>
	.pn_image_container {
		width: 100%;
		height: 100%;
		display: block;
		position: relative;
		overflow: hidden;
		border: none;
		padding: 0;
		background: var(--background-secondary);
	}

	.pn_image_container--static {
		cursor: default;
	}

	.pn_image_container:not(.pn_image_container--static) {
		cursor: pointer;
	}

	.pn_image_container img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
</style>
