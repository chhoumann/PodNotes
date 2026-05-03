<script lang="ts">
	import { ViewState } from "src/types/ViewState";
	import Icon from "../obsidian/Icon.svelte";

	export let viewState: ViewState = ViewState.PodcastGrid;
	export let canShowEpisodeList: boolean = false;
	export let canShowPlayer: boolean = false;

	const gridTooltip = "Browse podcast grid";
	const disabledEpisodeTooltip =
		"Select a podcast or playlist to view its episodes.";
	const disabledPlayerTooltip =
		"Start playing an episode to open the player.";

	$: episodeTooltip = canShowEpisodeList
		? "View episode list"
		: disabledEpisodeTooltip;
	$: playerTooltip = canShowPlayer
		? "Open player"
		: disabledPlayerTooltip;

	function handleClickMenuItem(newState: ViewState) {
		if (viewState === newState) return;

		if (newState === ViewState.EpisodeList && !canShowEpisodeList) return;

		if (newState === ViewState.Player && !canShowPlayer) return;

		viewState = newState;
	}

</script>

<div class="topbar-container">
	<button
		type="button"
		on:click={handleClickMenuItem.bind(null, ViewState.PodcastGrid)}
		class={`
            topbar-menu-button
            topbar-selectable
            ${viewState === ViewState.PodcastGrid ? "topbar-selected" : ""}
        `}
		aria-label="Podcast grid"
		aria-pressed={viewState === ViewState.PodcastGrid}
		title={gridTooltip}
	>
		<Icon icon="grid" size={18} clickable={false} />
	</button>
	<button
		type="button"
		on:click={handleClickMenuItem.bind(null, ViewState.EpisodeList)}
		class={`
            topbar-menu-button
            ${viewState === ViewState.EpisodeList ? "topbar-selected" : ""}
            ${canShowEpisodeList ? "topbar-selectable" : "topbar-disabled"}
        `}
		aria-label={
			canShowEpisodeList
				? "Episode list"
				: "Episode list (select a podcast or playlist first)"
		}
		aria-pressed={viewState === ViewState.EpisodeList}
		disabled={!canShowEpisodeList}
		title={episodeTooltip}
	>
		<Icon icon="list-minus" size={18} clickable={false} />
	</button>
	<button
		type="button"
		on:click={handleClickMenuItem.bind(null, ViewState.Player)}
		class={`
            topbar-menu-button
            ${viewState === ViewState.Player ? "topbar-selected" : ""}
            ${canShowPlayer ? "topbar-selectable" : "topbar-disabled"}
        `}
		aria-label={
			canShowPlayer
				? "Player"
				: "Player (start playing an episode to open the player)"
		}
		aria-pressed={viewState === ViewState.Player}
		disabled={!canShowPlayer}
		title={playerTooltip}
	>
		<Icon icon="play" size={18} clickable={false} />
	</button>
</div>

<style>
	.topbar-container {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.375rem 0.75rem;
		min-height: 2.5rem;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		box-sizing: border-box;
	}

	.topbar-menu-button {
		appearance: none;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2rem;
		padding: 0;
		flex: 0 0 auto;
		border: 1px solid transparent;
		border-radius: 0.375rem;
		background: transparent;
		box-shadow: none !important;
		color: var(--text-muted);
		transition:
			background-color 120ms ease,
			border-color 120ms ease,
			color 120ms ease;
	}

	.topbar-menu-button:focus-visible {
		outline: 2px solid var(--interactive-accent);
		outline-offset: 1px;
	}

	.topbar-selectable {
		cursor: pointer;
		color: var(--text-normal);
	}

	.topbar-selectable:hover:not(.topbar-selected) {
		background: var(--background-modifier-hover);
	}

	.topbar-selectable:active:not(.topbar-selected) {
		background: var(--background-modifier-border);
	}

	.topbar-selected,
	.topbar-selected:hover {
		color: var(--text-accent);
		background: var(--background-modifier-hover);
		border-color: var(--background-modifier-border);
	}

	.topbar-disabled,
	.topbar-menu-button:disabled {
		cursor: not-allowed;
		color: var(--text-faint);
		opacity: 0.5;
	}
</style>
