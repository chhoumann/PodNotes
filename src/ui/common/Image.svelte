<script lang="ts">
	import { createEventDispatcher } from "svelte";

	export let src: string;
	export let alt: string;
	export let fadeIn: boolean = false;
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
	<img 
		on:click={e => onClick(e)} 
		{src} 
		{alt} 
		class={_class}
		style:opacity={loaded ? 1 : 0}
		style:transition={fadeIn ? "opacity 0.5s ease-out" : ""}
		on:load={() => {loaded = true; loading = false;}}
		on:error={() => {failed = true; loading = false;}}
	/>
{:else if failed}
	<slot name="fallback" />
{/if}

<style>
	img:hover {
		cursor: pointer !important;
	}
</style>
