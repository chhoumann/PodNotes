<script lang="ts">
	import Image from "../Image.svelte";
	export let props: {
		src: string;
		alt: string;
		fadeIn?: boolean;
		opacity?: number;
		class?: string;
	};
</script>

<Image {...props}>
	<span slot="fallback">placeholder</span>
</Image>
