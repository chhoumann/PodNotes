<script lang="ts">
	import type { IconType } from "src/types/IconType";
	import type { Playlist } from "src/types/Playlist";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";

	const { navigation, library } = useServices();
	const { favorites, playlists } = library;
</script>

{#snippet row(playlist: Playlist, tile: IconType, favorite = false)}
	{@const count = playlist.episodes.length}
	<button
		type="button"
		class="pn-plrow"
		onclick={() => navigation.go({ kind: "playlist", name: playlist.name })}
	>
		<span class="pn-plicon" class:is-fav={favorite} {@attach icon(tile)}></span>
		<span class="txt">
			<span class="t">{playlist.name}</span>
			<span class="s">{count} {count === 1 ? "episode" : "episodes"}</span>
		</span>
		<span class="pn-plchevron" {@attach icon("chevron-right")}></span>
	</button>
{/snippet}

<div class="pn-nav">
	{@render row($favorites, "heart", true)}
	{#each Object.values($playlists) as playlist (playlist.name)}
		{@render row(playlist, playlist.icon)}
	{/each}
</div>
