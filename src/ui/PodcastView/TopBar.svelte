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
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.PodcastGrid)}
		class={`
            topbar-menu-button
            topbar-selectable
            ${viewState === ViewState.PodcastGrid ? "topbar-selected" : ""}
        `}
	>
		<Icon icon="grid" size={20} />
	</div>
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.EpisodeList)}
		class={`
            topbar-menu-button 
            ${viewState === ViewState.EpisodeList ? "topbar-selected" : ""}
            ${canShowEpisodeList ? "topbar-selectable" : ""}
        `}
	>
		<Icon icon="list-minus" size={20} />
	</div>
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.Player)}
		class={`
            topbar-menu-button 
            ${viewState === ViewState.Player ? "topbar-selected" : ""}
            ${canShowPlayer ? "topbar-selectable" : ""}
        `}
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
