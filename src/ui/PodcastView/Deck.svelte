<script lang="ts">
	import type { Snippet } from "svelte";
	import type { Chapter } from "src/types/Chapter";
	import type { Episode } from "src/types/Episode";
	import { formatDuration } from "src/utility/formatDuration";
	import { isLocalFile } from "src/utility/isLocalFile";
	import { ownRecord } from "src/utility/ownRecord";
	import { normalizeSkipLength } from "src/utility/skipLength";
	import { icon } from "../obsidian/icon";
	import { chapterAt } from "./chapters";
	import { useServices } from "./context";
	import { isPlaying, sourceOf } from "./episodeRow";
	import { anchorOf, noteEntry, rateMenu, showMenu } from "./menus";
	import type { Page } from "./pages";
	import Scrubber from "./Scrubber.svelte";

	/** The full player under its stage: title, scrubber, transport and capture bar. */
	let {
		chapters,
		onchapters,
		children,
	}: {
		chapters: readonly Chapter[];
		/** The current chapter's name opens the Chapters panel; none disables it. */
		onchapters?: () => void;
		/** Below the capture bar, such as the panel switch. */
		children?: Snippet;
	} = $props();
	const services = useServices();
	const { api, player, navigation, settings, library, rowHasNote, captureTimestamp } = services;
	const playerState = player.state;
	const { savedFeeds } = library;

	let volumeButton: HTMLButtonElement | undefined = $state();
	let volumeOpen = $state(false);
	let added = $state(false);
	let addedTimer: number | undefined;

	const episode = $derived($playerState.episode as Episode);
	const playing = $derived(isPlaying($playerState.status));
	const failed = $derived($playerState.status === "error");
	const duration = $derived($playerState.duration);
	const elapsed = $derived(Math.min($playerState.currentTime, duration));
	const current = $derived(chapterAt(chapters, elapsed));
	const back = $derived(normalizeSkipLength($settings.skipBackwardLength));
	const forward = $derived(normalizeSkipLength($settings.skipForwardLength));
	const source = $derived(sourceOf(episode));
	const sourcePage = $derived<Page | undefined>(
		isLocalFile(episode)
			? { kind: "local" }
			: ownRecord($savedFeeds)[episode.podcastName]
				? { kind: "feed", key: episode.podcastName }
				: undefined,
	);
	const note = $derived.by(() => {
		// A note made or removed since, also by a capture, changes the store.
		void $rowHasNote;
		return noteEntry(episode, services);
	});

	$effect(() => {
		if (failed) volumeOpen = false;
	});

	/** Escape closes the volume popover before it collapses the player. */
	export function closeVolume(): boolean {
		if (!volumeOpen) return false;
		volumeOpen = false;
		volumeButton?.focus();
		return true;
	}

	function closeOutside(popover: HTMLElement) {
		const close = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!popover.contains(target) && !volumeButton?.contains(target)) volumeOpen = false;
		};
		popover.doc.addEventListener("pointerdown", close, true);
		return () => popover.doc.removeEventListener("pointerdown", close, true);
	}

	async function capture() {
		if (!(await captureTimestamp())) return;
		added = true;
		window.clearTimeout(addedTimer);
		addedTimer = window.setTimeout(() => (added = false), 1200);
	}
</script>

<div class="pn-deck">
	<div class="pn-tb">
		<h2 class="pn-np-title" title={episode.title}>{episode.title}</h2>
		{#if sourcePage}
			{@const page = sourcePage}
			<button type="button" class="pn-bare pn-np-pod" onclick={() => navigation.go(page)}
				>{source}</button
			>
		{:else}
			<span class="pn-np-pod">{source}</span>
		{/if}
	</div>
	<div class="pn-scrubwrap">
		<Scrubber
			position={elapsed}
			{duration}
			{chapters}
			disabled={failed}
			onseek={(time) => player.seek(time)}
		/>
		<div class="pn-times">
			<span>{formatDuration(elapsed)}</span>
			{#if current >= 0}
				<button
					type="button"
					class="pn-bare pn-chapnow"
					title="Chapters"
					disabled={!onchapters}
					onclick={onchapters}>{chapters[current].title}</button
				>
			{:else}
				<span></span>
			{/if}
			<span class="r">-{formatDuration(Math.max(0, duration - elapsed))}</span>
		</div>
	</div>
	<div class="pn-transport">
		<button
			type="button"
			class="pn-bare pn-rate"
			aria-label="Playback speed {$playerState.playbackRate}x"
			aria-haspopup="menu"
			disabled={failed}
			onclick={(event) => showMenu(rateMenu(services), anchorOf(event))}
			><span>{$playerState.playbackRate}×</span></button
		>
		<div class="mid">
			<button
				type="button"
				class="pn-bare pn-skip"
				aria-label="Back {back} seconds"
				title="Back {back} seconds"
				disabled={failed}
				onclick={() => api.skipBackward()}
			>
				<span {@attach icon("rotate-ccw")}></span><b>{back}</b>
			</button>
			<button
				type="button"
				class="pn-play"
				aria-label={playing ? "Pause" : "Play"}
				title={playing ? "Pause" : "Play"}
				disabled={failed}
				onclick={() => player.toggle()}
				{@attach icon(playing ? "pause" : "play")}
			></button>
			<button
				type="button"
				class="pn-bare pn-skip"
				aria-label="Forward {forward} seconds"
				title="Forward {forward} seconds"
				disabled={failed}
				onclick={() => api.skipForward()}
			>
				<span {@attach icon("rotate-cw")}></span><b>{forward}</b>
			</button>
		</div>
		<button
			type="button"
			class="pn-bare pn-vol"
			aria-label="Volume {Math.round($playerState.volume * 100)}%"
			title="Volume"
			aria-expanded={volumeOpen}
			disabled={failed}
			bind:this={volumeButton}
			onclick={() => (volumeOpen = !volumeOpen)}
			{@attach icon($playerState.volume > 0 ? "volume-2" : "volume-x")}
		></button>
		{#if volumeOpen}
			<div class="pn-pop" {@attach closeOutside}>
				<input
					type="range"
					min="0"
					max="1"
					step="0.05"
					value={$playerState.volume}
					aria-label="Volume"
					oninput={(event) => player.setVolume(Number(event.currentTarget.value))}
				/>
				<span>{Math.round($playerState.volume * 100)}%</span>
			</div>
		{/if}
	</div>
	<div class="pn-capture">
		<button type="button" class="pn-btn mod-cta pn-cap" class:is-done={added} onclick={capture}>
			<span {@attach icon(added ? "check" : "clock-plus")}></span><span
				>{added ? "Added" : "Timestamp"}</span
			>
		</button>
		<button type="button" class="pn-btn pn-cap" onclick={() => note.onClick()}>
			<span {@attach icon(note.icon)}></span><span>{note.title}</span>
		</button>
	</div>
	{@render children?.()}
</div>

<style>
	.pn-deck {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: var(--size-4-3);
		padding: var(--size-4-3) var(--pn-pad);
	}

	.pn-deck :global {
		.pn-tb {
			min-width: 0;
			text-align: center;
		}

		.pn-np-title {
			margin: 0;
			font-size: var(--font-ui-medium);
			font-weight: var(--font-semibold);
			line-height: 1.3;
			letter-spacing: -0.005em;
			display: -webkit-box;
			-webkit-line-clamp: 2;
			line-clamp: 2;
			-webkit-box-orient: vertical;
			overflow: hidden;
			overflow-wrap: anywhere;
		}

		.pn-np-pod,
		.pn-chapnow {
			display: inline-block;
			min-width: 0;
			max-width: 100%;
			height: auto;
			padding: 1px var(--size-2-3);
			border-radius: var(--radius-s);
			color: var(--text-muted);
			font-size: inherit;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.pn-np-pod {
			margin-top: var(--size-2-2);
			vertical-align: top;
		}

		button.pn-np-pod:hover,
		.pn-chapnow:hover {
			background: var(--background-modifier-hover);
			color: var(--text-normal);
		}

		.pn-scrubwrap {
			display: flex;
			flex-direction: column;
			gap: var(--size-2-2);
		}

		.pn-times {
			display: grid;
			grid-template-columns: 1fr minmax(0, auto) 1fr;
			align-items: center;
			gap: var(--size-4-2);
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-variant-numeric: tabular-nums;
		}

		.r {
			text-align: right;
		}

		.pn-transport {
			position: relative;
			display: grid;
			grid-template-columns: 1fr auto 1fr;
			align-items: center;
		}

		.mid {
			display: flex;
			align-items: center;
			gap: var(--size-4-3);
		}

		:is(.pn-rate, .pn-skip, .pn-vol, .pn-play) {
			padding: 0;
		}

		.pn-rate {
			justify-self: start;
			min-width: 44px;
			height: var(--pn-skip);
		}

		.pn-rate span {
			display: inline-flex;
			align-items: center;
			height: 24px;
			padding: 0 var(--size-4-2);
			border: 1px solid var(--background-modifier-border-hover);
			border-radius: 12px;
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-weight: var(--font-semibold);
			font-variant-numeric: tabular-nums;
		}

		.pn-rate:hover:not(:disabled) span {
			border-color: var(--background-modifier-border-focus);
			color: var(--text-normal);
		}

		:is(.pn-skip, .pn-vol) {
			position: relative;
			width: var(--pn-skip);
			height: var(--pn-skip);
			border-radius: 50%;
		}

		:is(.pn-skip, .pn-vol):hover {
			background: var(--background-modifier-hover);
		}

		.pn-skip {
			--icon-size: 26px;
			--icon-stroke: 1.6px;
		}

		.pn-skip span {
			display: flex;
		}

		.pn-skip b {
			position: absolute;
			left: 0;
			right: 0;
			top: 50%;
			transform: translateY(-38%);
			font-size: 8.5px;
			letter-spacing: -0.02em;
		}

		.pn-play {
			width: var(--pn-play);
			height: var(--pn-play);
			border-radius: 50%;
			background: var(--text-normal);
			box-shadow: none;
			color: var(--pn-bg);
			transition: transform 120ms ease;
			--icon-size: calc(var(--pn-play) * 0.4);
		}

		.pn-play svg {
			fill: currentColor;
		}

		.pn-play .lucide-play {
			margin-left: 6%;
		}

		.pn-play:active {
			transform: scale(0.95);
		}

		.pn-vol {
			justify-self: end;
			color: var(--text-muted);
			--icon-size: 20px;
		}

		:is(.pn-rate, .pn-skip, .pn-vol, .pn-play):disabled {
			opacity: 0.35;
		}

		.pn-pop {
			position: absolute;
			right: 0;
			bottom: calc(100% + 6px);
			z-index: 5;
			display: flex;
			align-items: center;
			gap: var(--size-4-2);
			padding: var(--size-4-2) var(--size-4-3);
			border: 1px solid var(--background-modifier-border-hover);
			border-radius: var(--radius-m);
			background: var(--background-primary);
			box-shadow: var(--shadow-s);
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-variant-numeric: tabular-nums;
		}

		.pn-pop input {
			width: 120px;
		}

		.pn-pop span {
			min-width: 4ch;
			text-align: right;
		}

		.pn-capture {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: var(--size-4-2);
		}

		button.pn-cap {
			min-width: 0;
			height: var(--pn-cap-h);
			font-weight: var(--font-medium);
			--icon-size: 17px;
		}

		button.pn-cap.is-done {
			background: var(--background-modifier-success);
		}

		.pn-cap span {
			display: flex;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.pn-deck :global(.pn-play) {
			transition: none;
		}
	}

	:global(.is-phone) .pn-deck {
		gap: var(--size-4-4);
		padding-bottom: var(--size-4-2);
	}

	:global(.is-phone) .pn-deck :global {
		.pn-rate span {
			height: 30px;
			padding: 0 var(--size-4-3);
			border-radius: 15px;
		}

		.pn-skip {
			--icon-size: 30px;
		}

		.pn-skip b {
			font-size: 10px;
		}

		button.pn-cap {
			--icon-size: 20px;
		}
	}

	:global(.is-wide) .pn-deck {
		gap: var(--size-4-4);
		padding: var(--size-4-4) var(--size-4-6) 0;
	}

	:global(.is-wide) .pn-deck :global(.pn-np-title) {
		font-size: var(--font-ui-large);
		line-height: 1.25;
		letter-spacing: -0.01em;
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}
</style>
