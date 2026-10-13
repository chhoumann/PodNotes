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
		class="pn-plrow"
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

<div class="pn-nav">
	{@render row($favorites, "heart", true)}
	{#each Object.values($playlists) as playlist (playlist.name)}
		{@render row(playlist, playlist.icon, false)}
	{/each}
	<button type="button" class="pn-plrow is-new" onclick={() => void actions.createPlaylist()}>
		<span class="pn-plicon" {@attach icon("plus")}></span>
		<span class="txt"><span class="t">New playlist</span></span>
	</button>
</div>
