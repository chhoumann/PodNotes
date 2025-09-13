<script lang="ts">
	import type { CSSObject } from "src/types/CSSObject";
	import extractStylesFromObj from "src/utility/extractStylesFromObj";
	import { createEventDispatcher } from "svelte";

	export let max: number;
	export let value: number;
	export { _styled as style };

	let isDragging = false;
	const _styled: CSSObject = {};

	let styles: string;

	$: {
		styles = extractStylesFromObj(_styled);
	}

	const dispatch = createEventDispatcher();

	function forwardClick(e: MouseEvent) {
		dispatch("click", { event: e });
	}

	function onDragStart() {
		isDragging = true;
	}

	function onDragEnd() {
		isDragging = false;
	}

	function handleDragging(e: MouseEvent) {
		if (!isDragging) return;

		forwardClick(e);
	}
</script>

<progress
	style={styles}
	{max}
	{value}
	on:click={forwardClick}
	on:mousedown={onDragStart}
	on:mouseup={onDragEnd}
	on:mousemove={handleDragging}
/>
