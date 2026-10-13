<script lang="ts">
	import { Notice } from "obsidian";
	import { formatDuration } from "src/utility/formatDuration";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import type { Layout } from "./layout";

	let { layout }: { layout: Layout } = $props();
	const { player, navigation, captureTimestamp } = useServices();
	const playerState = player.state;

	const episode = $derived($playerState.episode);
	const playing = $derived(
		$playerState.status === "playing" || $playerState.status === "loading",
	);
	const duration = $derived($playerState.duration);
	const elapsed = $derived(Math.min($playerState.currentTime, duration));
	const remaining = $derived(Math.max(0, duration - elapsed));
	const percent = $derived(duration > 0 ? (elapsed / duration) * 100 : 0);
	const left = $derived(remaining > 0 ? ` · ${minutes(remaining)} left` : "");
	let failedArtworkUrl = $state("");
	const id = $props.id();

	function minutes(seconds: number): string {
		const total = Math.max(1, Math.round(seconds / 60));
		return total >= 60 ? `${Math.floor(total / 60)} h ${total % 60} min` : `${total} min`;
	}

	async function capture() {
		const note = await captureTimestamp();
		if (note) new Notice(`Timestamp added to ${note}`);
	}
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
			class="pn-mini-open"
			aria-label="Open player: {episode.title}"
			onclick={() => navigation.expand()}
		>
			{#if episode.artworkUrl && episode.artworkUrl !== failedArtworkUrl}
				<img
					class="pn-mini-cover"
					src={episode.artworkUrl}
					alt=""
					onerror={() => (failedArtworkUrl = episode.artworkUrl ?? "")}
				/>
			{:else}
				<span
					class="pn-mini-cover pn-filetile"
					{@attach icon($playerState.mediaType === "video" ? "video" : "music")}
				></span>
			{/if}
			<span class="pn-mini-txt">
				<span class="pn-mini-t">{episode.title}</span>
				<span class="pn-mini-s">
					{episode.podcastName}{left}
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
				title="Capture timestamp"
				onclick={capture}
				{@attach icon("clock-plus")}
			></button>
		{/if}
		<button
			type="button"
			class="pn-iconbtn pn-mini-toggle"
			aria-label={playing ? "Pause" : "Play"}
			title={playing ? "Pause" : "Play"}
			onclick={() => player.toggle()}
			{@attach icon(playing ? "pause" : "play")}
		></button>
	</section>
{/if}

<style>
	.pn-mini {
		position: relative;
		flex: none;
		display: flex;
		align-items: center;
		gap: var(--size-2-2);
		height: 56px;
		padding: 0 var(--size-4-2) 0 var(--size-4-1);
		background: var(--pn-surface);
		border-top: 1px solid var(--background-modifier-border);
	}

	.pn-mini.is-wide {
		height: 64px;
		gap: var(--size-4-3);
		padding: 0 var(--size-4-4) 0 var(--size-4-3);
	}

	:global(.is-phone) .pn-mini {
		height: 64px;
		padding: 0 var(--size-4-2);
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

	.pn-mini-open {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: var(--size-4-3);
		height: auto;
		padding: var(--size-4-1);
		border: 0;
		border-radius: var(--radius-s);
		background: none;
		box-shadow: none;
		color: var(--text-normal);
		font-size: var(--font-ui-small);
		text-align: left;
		cursor: var(--cursor);
	}

	.pn-mini-open:hover {
		background: var(--background-modifier-hover);
	}

	.is-wide .pn-mini-open {
		flex: 0 1 300px;
	}

	.pn-mini-cover {
		flex: none;
		width: 36px;
		height: 36px;
		border-radius: 5px;
		object-fit: cover;
	}

	.is-wide .pn-mini-cover,
	:global(.is-phone) .pn-mini-cover {
		width: 44px;
		height: 44px;
	}

	.pn-filetile {
		display: flex;
		align-items: center;
		justify-content: center;
		background: var(--background-modifier-hover);
		color: var(--text-muted);
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

	.pn-mini .pn-iconbtn {
		width: 36px;
		height: 36px;
		opacity: 1;
		color: var(--text-normal);
	}

	:global(.is-phone) .pn-mini .pn-iconbtn {
		width: 44px;
		height: 44px;
	}

	.pn-mini .pn-mini-capture {
		color: var(--text-accent);
	}

	.pn-mini-toggle :global(svg) {
		fill: currentColor;
	}

	.is-wide .pn-btn {
		height: 30px;
	}
</style>
