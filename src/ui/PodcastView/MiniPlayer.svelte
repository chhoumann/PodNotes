<script lang="ts">
	import { formatDuration } from "src/utility/formatDuration";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import { isPlaying } from "src/player/PlayerController";
	import { formatMinutes, sourceOf, tileOf } from "./episodeRow";
	import type { Layout } from "./layout";

	let { layout }: { layout: Layout } = $props();
	const { player, navigation, captureTimestamp } = useServices();
	const playerState = player.state;

	const episode = $derived($playerState.episode);
	const playing = $derived(isPlaying($playerState.status));
	const duration = $derived($playerState.duration);
	const elapsed = $derived(Math.min($playerState.currentTime, duration));
	const remaining = $derived(Math.max(0, duration - elapsed));
	const percent = $derived(duration > 0 ? (elapsed / duration) * 100 : 0);
	const left = $derived(remaining > 0 ? ` · ${formatMinutes(remaining)} left` : "");
	const id = $props.id();

	const capture = () => void captureTimestamp();
</script>

{#snippet progress(kind: "pn-mini-prog" | "pn-mini-track")}
	<div
		class={kind}
		role="progressbar"
		aria-labelledby="{id}-progress"
		aria-valuemin={0}
		aria-valuemax={Math.floor(duration)}
		aria-valuenow={Math.floor(elapsed)}
		aria-valuetext="{formatDuration(elapsed)} of {formatDuration(duration)}"
	>
		<span style:width="{percent}%"></span>
	</div>
{/snippet}

{#if episode}
	<section class="pn-mini" class:is-wide={layout === "wide"} aria-labelledby="{id}-name">
		<span id="{id}-name" hidden>Now playing</span>
		<span id="{id}-progress" hidden>Episode progress</span>
		{#if layout === "compact"}
			{@render progress("pn-mini-prog")}
		{/if}
		<button
			type="button"
			class="pn-bare pn-mini-open"
			aria-label="Open player: {episode.title}"
			onclick={() => navigation.expand()}
		>
			<Cover src={episode.artworkUrl} title={episode.podcastName} tile={tileOf(episode)} />
			<span class="pn-mini-txt">
				<span class="pn-mini-t">{episode.title}</span>
				<span class="pn-mini-s">
					{sourceOf(episode)}{left}
				</span>
			</span>
		</button>
		{#if layout === "wide"}
			<div class="pn-mini-mid">
				<span aria-hidden="true">{formatDuration(elapsed)}</span>
				{@render progress("pn-mini-track")}
				<span aria-hidden="true">-{formatDuration(remaining)}</span>
			</div>
			<button type="button" class="pn-btn mod-cta" onclick={capture}>
				<span class="pn-btn-icon" {@attach icon("clock-plus")}></span>
				<span>Timestamp</span>
			</button>
		{:else}
			<button
				type="button"
				class="pn-iconbtn pn-mini-capture"
				aria-label="Capture timestamp"
				onclick={capture}
				{@attach icon("clock-plus")}
			></button>
		{/if}
		<button
			type="button"
			class="pn-iconbtn pn-mini-toggle"
			aria-label={playing ? "Pause" : "Play"}
			onclick={() => player.toggle()}
			{@attach icon(playing ? "pause" : "play")}
		></button>
	</section>
{/if}

<style>
	/* Its controls sit above Obsidian's status bar, which floats over the view's bottom. */
	.pn-mini :global {
		--pn-btn: 36px;
		position: relative;
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--size-2-2);
		height: calc(56px + var(--pn-status-bar));
		padding: 0 var(--size-4-2) var(--pn-status-bar) var(--size-4-1);
		background: var(--pn-surface);
		border-top: 1px solid var(--background-modifier-border);

		&.is-wide {
			height: calc(64px + var(--pn-status-bar));
			gap: var(--size-4-3);
			padding: 0 var(--size-4-4) var(--pn-status-bar) var(--size-4-3);
		}

		.is-phone & {
			--pn-btn: 44px;
			height: 64px;
			padding: 0 var(--size-4-2);
		}

		.pn-mini-open {
			flex: 1;
			min-width: 0;
			display: flex;
			gap: var(--size-4-3);
			height: auto;
			padding: var(--size-4-1);
			border-radius: var(--radius-s);
			color: var(--text-normal);
			text-align: left;
		}

		@media (hover: hover) {
			.pn-mini-open:hover {
				background: var(--background-modifier-hover);
			}
		}

		.pn-mini-prog {
			position: absolute;
			left: 0;
			right: 0;
			top: -1px;
			height: 2px;
		}

		.pn-mini-prog span,
		.pn-mini-track span {
			display: block;
			height: 100%;
			background: var(--interactive-accent);
		}

		.pn-mini-open .pn-cover {
			width: 36px;
			border-radius: 5px;
		}

		.pn-mini-txt {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.pn-mini-t {
			font-weight: var(--font-medium);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.pn-mini-s {
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			font-variant-numeric: tabular-nums;
		}

		.pn-mini-mid {
			flex: 1;
			display: flex;
			align-items: center;
			gap: var(--size-4-2);
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-variant-numeric: tabular-nums;
		}

		.pn-mini-track {
			flex: 1;
			height: 4px;
			border-radius: 2px;
			background: var(--background-modifier-border-hover);
			overflow: hidden;
		}

		button.pn-iconbtn {
			opacity: 1;
			color: var(--text-normal);
		}

		button.pn-mini-capture {
			color: var(--text-accent);
		}

		.pn-mini-toggle svg {
			fill: currentColor;
		}

		.pn-btn-icon {
			display: flex;
			--icon-size: var(--icon-s);
			--icon-stroke: var(--icon-s-stroke-width);
		}

		&.is-wide {
			.pn-mini-open {
				flex: 0 1 300px;
			}

			.pn-mini-open .pn-cover {
				width: 44px;
			}

			button.pn-btn {
				height: 30px;
			}
		}

		.is-phone & .pn-mini-open .pn-cover {
			width: 44px;
		}
	}
</style>
