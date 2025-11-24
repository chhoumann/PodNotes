<script lang="ts">
	import { ViewState } from "src/types/ViewState";
	import Icon from "../obsidian/Icon.svelte";

	export let viewState: ViewState = ViewState.PodcastGrid;
	export let canShowEpisodeList: boolean = false;
	export let canShowPlayer: boolean = false;

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
	>
		<Icon icon="grid" size={20} clickable={false} />
	</button>
	<button
		type="button"
		on:click={handleClickMenuItem.bind(null, ViewState.EpisodeList)}
		class={`
            topbar-menu-button
            ${viewState === ViewState.EpisodeList ? "topbar-selected" : ""}
            ${canShowEpisodeList ? "topbar-selectable" : ""}
        `}
		aria-label="Episode list"
		aria-pressed={viewState === ViewState.EpisodeList}
		disabled={!canShowEpisodeList}
	>
		<Icon icon="list-minus" size={20} clickable={false} />
	</button>
	<button
		type="button"
		on:click={handleClickMenuItem.bind(null, ViewState.Player)}
		class={`
            topbar-menu-button
            ${viewState === ViewState.Player ? "topbar-selected" : ""}
            ${canShowPlayer ? "topbar-selectable" : ""}
        `}
		aria-label="Player"
		aria-pressed={viewState === ViewState.Player}
		disabled={!canShowPlayer}
	>
		<Icon icon="play" size={20} clickable={false} />
	</button>
</div>

<style>
	.topbar-container {
		display: flex;
		flex-direction: row;
		align-items: center;
		justify-content: space-between;
		height: 50px;
		min-height: 50px;
		border-bottom: 1px solid var(--background-divider);
	}

	.topbar-menu-button {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		color: var(--text-muted, #8a8f98);
		opacity: 1;
		border: none;
		background: none;
		padding: 0;
		transition: color 120ms ease, background-color 120ms ease,
			box-shadow 120ms ease, opacity 120ms ease;
	}

	.topbar-menu-button:focus-visible {
		outline: 2px solid var(--interactive-accent, #5c6bf7);
		outline-offset: 2px;
	}

	.topbar-menu-button:disabled {
		color: var(--text-faint, #6b6b6b);
		opacity: 0.45;
		cursor: not-allowed;
	}

	.topbar-selectable {
		cursor: pointer;
		color: var(--text-normal, #dfe2e7);
	}

	.topbar-selectable:hover {
		background-color: var(--background-divider);
	}

	.topbar-selected {
		color: var(--interactive-accent, #5c6bf7);
		background-color: var(--background-secondary, var(--background-divider));
		box-shadow: inset 0 -2px var(--interactive-accent, #5c6bf7);
	}
</style>
