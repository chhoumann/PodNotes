<script lang="ts">
	// https://css-tricks.com/lazy-loading-images-in-svelte/
	export let src: string;
	export let alt: string;
	export let fadeIn: boolean = false;
	export { _class as class };

	let _class: string = "";

	import IntersectionObserver from "./IntersectionObserver.svelte";
	import Image from "./Image.svelte";
	import { createEventDispatcher } from "svelte";
	import Loading from "../PodcastView/Loading.svelte";

	const dispatcher = createEventDispatcher();
</script>

<IntersectionObserver once={true} let:intersecting>
	{#if intersecting}
		<Image
			{alt} 
			{src} 
			{fadeIn}
			on:click={event => dispatcher('click', { event })} 
			class={_class}
		/>
	{/if}
</IntersectionObserver>
