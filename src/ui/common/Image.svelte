<script lang="ts">
	import { createEventDispatcher } from "svelte";

	export let src: string;
	export let alt: string;
	export let fadeIn: boolean = false;
	export let opacity: number = 0; // Falsey value so condition isn't triggered if not set.
	export {_class as class};
	let _class = "";

	let loaded = false;
	let loading = true;
	let failed = false;

	const dispatcher = createEventDispatcher();

	function onClick(event: MouseEvent) {
		dispatcher("click", { event });
	}
</script>

{#if loading || loaded}
<div class="pn_image_container">
	<img 
		on:click={e => onClick(e)} 
		draggable="false"
		{src} 
		{alt} 
		class={_class}
		style:opacity={opacity ? opacity : !fadeIn ? 1 : loaded ? 1 : 0}
		style:transition={fadeIn ? "opacity 0.5s ease-out" : ""}
		on:load={() => {loaded = true; loading = false;}}
		on:error={() => {failed = true; loading = false;}}
	/>
</div>
{:else if failed}
	<slot name="fallback" />
{/if}

<style>
	img:hover {
		cursor: pointer !important;
	}

	.pn_image_container {
		width: 100%;
		height: 100%;
		display: block;
		position: relative;
		overflow: hidden;
	}
</style>
