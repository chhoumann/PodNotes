<script lang="ts">
	import type { Chapter } from "src/types/Chapter";
	import { formatDuration } from "src/utility/formatDuration";
	import { segmentsOf } from "./chapters";

	let {
		position,
		duration,
		chapters,
		disabled,
		onseek,
	}: {
		position: number;
		duration: number;
		chapters: readonly Chapter[];
		disabled: boolean;
		/** Once per press or key, in seconds within the episode. */
		onseek(time: number): void;
	} = $props();

	/** A press under way: the thumb follows the pointer, and the seek waits for the release. */
	let drag = $state.raw<{ readonly pointerId: number; readonly time: number }>();
	const off = $derived(disabled || !(duration > 0));
	const shown = $derived(drag?.time ?? position);
	const segments = $derived(segmentsOf(chapters, duration));
	const fill = (from: number, to: number) =>
		to > from ? Math.min(1, Math.max(0, (shown - from) / (to - from))) * 100 : 0;
	const clamp = (time: number) => Math.min(duration, Math.max(0, time));
	const KEYS: Record<string, (time: number) => number> = {
		ArrowLeft: (time) => time - 5,
		ArrowDown: (time) => time - 5,
		ArrowRight: (time) => time + 5,
		ArrowUp: (time) => time + 5,
		PageDown: (time) => time - 30,
		PageUp: (time) => time + 30,
		Home: () => 0,
		End: () => duration,
	};

	function timeAt(event: PointerEvent): number {
		const { left, width } = (event.currentTarget as HTMLElement).getBoundingClientRect();
		return width > 0 ? clamp(((event.clientX - left) / width) * duration) : 0;
	}

	function press(event: PointerEvent) {
		if (off || event.button !== 0) return;
		(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
		drag = { pointerId: event.pointerId, time: timeAt(event) };
	}

	function move(event: PointerEvent) {
		if (drag?.pointerId === event.pointerId) drag = { ...drag, time: timeAt(event) };
	}

	function release(event: PointerEvent) {
		if (drag?.pointerId !== event.pointerId) return;
		const { time } = drag;
		drag = undefined;
		onseek(time);
	}

	function keydown(event: KeyboardEvent) {
		const step = KEYS[event.key];
		if (off || !step) return;
		event.preventDefault();
		onseek(clamp(step(position)));
	}
</script>

<div
	class="pn-scrub"
	role="slider"
	tabindex={off ? -1 : 0}
	aria-label="Seek"
	aria-valuemin={0}
	aria-valuemax={Math.floor(duration)}
	aria-valuenow={Math.floor(shown)}
	aria-valuetext="{formatDuration(shown)} of {formatDuration(duration)}"
	aria-disabled={off}
	onpointerdown={press}
	onpointermove={move}
	onpointerup={release}
	onpointercancel={() => (drag = undefined)}
	onkeydown={keydown}
>
	<span class="pn-segs">
		{#each segments as [from, to] (from)}
			<span class="pn-seg" style:flex-grow={to - from}>
				<span style:width="{fill(from, to)}%"></span>
			</span>
		{/each}
	</span>
	<span class="pn-thumb" style:left="{duration > 0 ? (shown / duration) * 100 : 0}%"></span>
</div>

<style>
	.pn-scrub {
		position: relative;
		height: 16px;
		display: flex;
		align-items: center;
		cursor: pointer;
		touch-action: none;
	}

	.pn-scrub:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 3px;
		border-radius: 4px;
	}

	.pn-scrub[aria-disabled="true"] {
		opacity: 0.5;
		cursor: default;
	}

	.pn-scrub :global {
		.pn-segs {
			display: flex;
			gap: 2px;
			width: 100%;
			height: 4px;
		}

		.pn-seg {
			flex: 1 1 0;
			min-width: 2px;
			border-radius: 2px;
			background: var(--background-modifier-border-hover);
			overflow: hidden;
		}

		.pn-seg span {
			display: block;
			height: 100%;
			background: var(--interactive-accent);
		}

		.pn-thumb {
			position: absolute;
			top: 50%;
			width: 12px;
			height: 12px;
			margin: -6px 0 0 -6px;
			border-radius: 50%;
			background: var(--interactive-accent);
			box-shadow: 0 0 0 2px var(--pn-bg);
			pointer-events: none;
		}
	}

	:global(.is-phone) .pn-scrub {
		height: 44px;
		margin: -8px 0;
	}

	:global(.is-phone) .pn-scrub :global {
		.pn-segs {
			height: 5px;
		}

		.pn-thumb {
			width: 16px;
			height: 16px;
			margin: -8px 0 0 -8px;
		}
	}
</style>
