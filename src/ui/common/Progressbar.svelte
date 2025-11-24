<script lang="ts">
import type { CSSObject } from "src/types/CSSObject";
import extractStylesFromObj from "src/utility/extractStylesFromObj";
import { createEventDispatcher } from "svelte";

export let max: number;
export let value: number;
export { _styled as style };

let isDragging: boolean = false;
let _styled: CSSObject = {};
let progressRef: HTMLDivElement;

let styles: string;

$: {
	styles = extractStylesFromObj(_styled);
}

const dispatch = createEventDispatcher();

function forwardClick(e: MouseEvent | KeyboardEvent, percent?: number) {
	dispatch("click", { event: e, percent });
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

function handleKeyDown(event: KeyboardEvent) {
	if (!progressRef || !max) return;
	const step = max * 0.05;
	let nextValue = value;

	switch (event.key) {
		case "ArrowRight":
		case "ArrowUp":
			nextValue = Math.min(max, value + step);
			break;
		case "ArrowLeft":
		case "ArrowDown":
			nextValue = Math.max(0, value - step);
			break;
		case "Home":
			nextValue = 0;
			break;
		case "End":
			nextValue = max;
			break;
		case "Enter":
		case " ":
			// Keep current value; allow parent to handle if needed.
			nextValue = value;
			break;
		default:
			return;
	}

	event.preventDefault();
	const percent = max ? nextValue / max : 0;
	forwardClick(event, percent);
}
</script>

<div
	class="progress"
	role="slider"
	tabindex="0"
	aria-valuemin="0"
	aria-valuemax={max}
	aria-valuenow={value}
	style={styles}
	on:click={forwardClick}
	on:mousedown={onDragStart}
	on:mouseup={onDragEnd}
	on:mousemove={handleDragging}
	on:keydown={handleKeyDown}
	bind:this={progressRef}
>
	<div
		class="progress__bar"
		style={`width: ${max ? Math.min(100, (value / max) * 100) : 0}%;`}
	></div>
</div>

<style>
	.progress {
		position: relative;
		width: 100%;
		height: 0.5rem;
		background: var(--background-modifier-border);
		border-radius: 9999px;
		overflow: hidden;
		cursor: pointer;
		transition: height 120ms ease;
	}

	.progress:hover,
	.progress:focus-visible {
		height: 0.625rem;
	}

	.progress:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 2px;
	}

	.progress__bar {
		position: absolute;
		top: 0;
		left: 0;
		height: 100%;
		background: var(--interactive-accent);
		border-radius: 9999px;
		transition: width 50ms linear;
	}
</style>
