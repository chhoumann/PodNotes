<script lang="ts">
	import type { IconType } from "src/types/IconType";
	import type { Playlist } from "src/types/Playlist";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import { formatMinutes, totalSeconds } from "./episodeRow";
	import { anchorOf, playlistMenu, showMenu } from "./menus";

	const services = useServices();
	const { navigation, actions, library } = services;
	const { favorites, playlists, playedEpisodes } = library;

	function summary({ episodes }: Playlist): string {
		const total = totalSeconds(episodes, $playedEpisodes);
		const count = `${episodes.length} ${episodes.length === 1 ? "episode" : "episodes"}`;
		return total > 0 ? `${count} · ${formatMinutes(total)}` : count;
	}
</script>

{#snippet row(playlist: Playlist, tile: IconType, favorite: boolean)}
	<button
		type="button"
		class="pn-bare pn-plrow"
		onclick={() => navigation.go({ kind: "playlist", name: playlist.name })}
		oncontextmenu={favorite
			? undefined
			: (event) => showMenu(playlistMenu(playlist.name, services), anchorOf(event))}
	>
		<span class="pn-plicon" class:is-fav={favorite} {@attach icon(tile)}></span>
		<span class="txt">
			<span class="t">{playlist.name}</span>
			<span class="s">{summary(playlist)}</span>
		</span>
		<span class="pn-plchevron" {@attach icon("chevron-right")}></span>
	</button>
{/snippet}

<div class="pn-nav pn-playlists">
	{@render row($favorites, "heart", true)}
	{#each Object.values($playlists) as playlist (playlist.name)}
		{@render row(playlist, playlist.icon, false)}
	{/each}
	<button
		type="button"
		class="pn-bare pn-plrow is-new"
		onclick={() => void actions.createPlaylist()}
	>
		<span class="pn-plicon" {@attach icon("plus")}></span>
		<span class="txt"><span class="t">New playlist</span></span>
	</button>
</div>

<style>
	.pn-playlists :global {
		.pn-plrow {
			display: flex;
			align-items: center;
			gap: var(--size-4-3);
			width: 100%;
			height: auto;
			padding: var(--size-4-2);
			border-radius: var(--radius-s);
			color: var(--text-normal);
			font-weight: inherit;
			text-align: left;
		}

		.pn-plrow:hover {
			background: var(--background-modifier-hover);
		}

		.pn-plicon {
			display: flex;
			align-items: center;
			justify-content: center;
			flex: none;
			width: 44px;
			height: 44px;
			border-radius: 8px;
			background: var(--background-modifier-border);
			color: var(--text-muted);
			--icon-size: 20px;
		}

		.pn-plicon.is-fav {
			background: rgba(var(--color-pink-rgb), 0.16);
			color: var(--color-pink);
		}

		.pn-plrow .txt {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			gap: 2px;
		}

		.pn-plrow .t {
			font-weight: var(--font-medium);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.pn-plrow .s {
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
		}

		.pn-plchevron {
			display: flex;
			color: var(--text-muted);
			--icon-size: 16px;
		}

		.pn-plrow.is-new .pn-plicon {
			background: none;
			border: 1px dashed var(--background-modifier-border-hover);
		}

		.pn-plrow.is-new .t {
			color: var(--text-muted);
			font-weight: var(--font-normal);
		}
	}
</style>
