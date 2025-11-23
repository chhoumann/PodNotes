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

	function handleKeyMenuItem(event: KeyboardEvent, newState: ViewState) {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		handleClickMenuItem(newState);
	}
</script>

<div class="topbar-container">
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.PodcastGrid)}
		on:keydown={(event) => handleKeyMenuItem(event, ViewState.PodcastGrid)}
		class={`
            topbar-menu-button
            topbar-selectable
            ${viewState === ViewState.PodcastGrid ? "topbar-selected" : ""}
        `}
		role="button"
		tabindex="0"
		aria-label="Podcast grid"
	>
		<Icon icon="grid" size={20} />
	</div>
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.EpisodeList)}
		on:keydown={(event) => handleKeyMenuItem(event, ViewState.EpisodeList)}
		class={`
            topbar-menu-button 
            ${viewState === ViewState.EpisodeList ? "topbar-selected" : ""}
            ${canShowEpisodeList ? "topbar-selectable" : ""}
        `}
		role="button"
		tabindex={canShowEpisodeList ? 0 : -1}
		aria-label="Episode list"
	>
		<Icon icon="list-minus" size={20} />
	</div>
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.Player)}
		on:keydown={(event) => handleKeyMenuItem(event, ViewState.Player)}
		class={`
            topbar-menu-button 
            ${viewState === ViewState.Player ? "topbar-selected" : ""}
            ${canShowPlayer ? "topbar-selectable" : ""}
        `}
		role="button"
		tabindex={canShowPlayer ? 0 : -1}
		aria-label="Player"
	>
		<Icon icon="play" size={20} />
	</div>
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
		opacity: 0.1;
	}

	.topbar-selected {
		opacity: 1 !important;
	}

	.topbar-selectable {
		cursor: pointer;
		opacity: 0.5;
	}
</style>
