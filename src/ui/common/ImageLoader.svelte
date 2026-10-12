<script lang="ts">
	export let src: string;
	export let alt: string;
	export let fadeIn: boolean = false;
	export let width: string | number | undefined;
	export let height: string | number | undefined;
	export let aspectRatio: string | undefined = "1 / 1";
	export let loading: "lazy" | "eager" | null | undefined = "lazy";
	export { _class as class };

	let _class: string = "";

	import Image from "./Image.svelte";

	const toDimension = (value?: string | number) =>
		typeof value === "number" ? `${value}px` : value;

	$: resolvedWidth = toDimension(width);
	$: resolvedHeight = toDimension(height);
	$: resolvedAspectRatio = resolvedHeight ? undefined : aspectRatio;
</script>

<div
	class="image-loader"
	style:width={resolvedWidth}
	style:height={resolvedHeight}
	style:aspect-ratio={resolvedAspectRatio}
>
	<Image {alt} {src} {fadeIn} {loading} class={_class} />
</div>

<style>
	.image-loader {
		position: relative;
		width: 100%;
	}
</style>
