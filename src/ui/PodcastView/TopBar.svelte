<script lang="ts">
	import { setIcon } from "obsidian";
	import { ViewState } from "src/types/ViewState";
	import { onMount } from "svelte";

	export let viewState: ViewState = ViewState.FeedGrid;
	export let canShowEpisodeList: boolean = false;
	export let canShowPlayer: boolean = false;

	let feedGridIconRef: HTMLSpanElement;
	let episodeListIconRef: HTMLSpanElement;
	let playerIconRef: HTMLSpanElement;

	onMount(() => {
		setIcon(feedGridIconRef, "grid");
		setIcon(episodeListIconRef, "list-minus");
		setIcon(playerIconRef, "play");
	});

	function handleClickMenuItem(newState: ViewState) {
		if (viewState === newState) return;

		if (newState === ViewState.EpisodeList && !canShowEpisodeList) return;

		if (newState === ViewState.Player && !canShowPlayer) return;

		viewState = newState;
	}
</script>

<div class="topbar-container">
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.FeedGrid)}
		class={`
            topbar-menu-button
            topbar-selectable
            ${viewState === ViewState.FeedGrid ? "topbar-selected" : ""}
        `}
	>
		<span bind:this={feedGridIconRef} />
	</div>
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.EpisodeList)}
		class={`
            topbar-menu-button 
            ${viewState === ViewState.EpisodeList ? "topbar-selected" : ""}
            ${canShowEpisodeList ? "topbar-selectable" : ""}
        `}
	>
		<span bind:this={episodeListIconRef} />
	</div>
	<div
		on:click={handleClickMenuItem.bind(null, ViewState.Player)}
		class={`
            topbar-menu-button 
            ${viewState === ViewState.Player ? "topbar-selected" : ""}
            ${canShowPlayer ? "topbar-selectable" : ""}
        `}
	>
		<span bind:this={playerIconRef} />
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
