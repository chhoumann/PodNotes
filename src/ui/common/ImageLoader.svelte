<script lang="ts">
	export let src: string;
	export let alt: string;
	export let fadeIn: boolean = false;
	export let interactive: boolean = false;
	export let loadingMode: "lazy" | "eager" | undefined = "lazy";
	export { _class as class };

	let _class: string = "";

	import Image from "./Image.svelte";
	import { createEventDispatcher } from "svelte";

	const dispatcher = createEventDispatcher();
</script>

<Image
	{alt}
	{src}
	{fadeIn}
	{interactive}
	loadingMode={loadingMode}
	on:click={event => dispatcher("click", { event })}
	class={_class}
/>
