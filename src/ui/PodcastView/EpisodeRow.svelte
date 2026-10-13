<script lang="ts">
	import type { Snippet } from "svelte";
	import type { Episode } from "src/types/Episode";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import { episodeRowModel } from "./episodeRow";
	import { anchorOf, type MenuAnchor } from "./menus";

	let {
		episode,
		cover = false,
		date = !cover,
		available = true,
		onplay,
		onmenu,
		leading,
		trailing,
	}: {
		episode: Episode;
		cover?: boolean;
		/** The episode's date. Rows with a cover name their source instead, except Latest's. */
		date?: boolean;
		available?: boolean;
		onplay(): void;
		onmenu(at: MenuAnchor): void;
		/** Before the row's button, such as the queue's grip. */
		leading?: Snippet;
		/** In place of the More button, such as the queue's remove button. */
		trailing?: Snippet;
	} = $props();
	const { player, library, rowHasNote } = useServices();
	const { playedEpisodes, downloadedEpisodes } = library;
	const playerState = player.state;
	// The player's state changes many times a second; a row changes only with these.
	const now = $derived($playerState.episode);
	const playing = $derived(
		$playerState.status === "playing" || $playerState.status === "loading",
	);
	// A vault lookup, so it runs again only when notes change, not on every change to the library.
	const noted = $derived($rowHasNote(episode));
	const row = $derived(
		episodeRowModel(episode, {
			played: $playedEpisodes,
			downloads: $downloadedEpisodes,
			now,
			playing,
			hasNote: noted,
			cover,
			date,
			available,
		}),
	);
	const menu = (event: MouseEvent) => onmenu(anchorOf(event));
</script>

<div
	class="pn-ep"
	class:is-played={row.played}
	class:is-current={row.current}
	class:is-unavailable={row.unavailable}
	role="listitem"
>
	{@render leading?.()}
	<button
		type="button"
		class="pn-ep-main"
		aria-label={row.label}
		aria-disabled={row.unavailable || undefined}
		title={episode.title}
		onclick={onplay}
		oncontextmenu={menu}
	>
		{#if row.tile}
			<span class="pn-cover pn-filetile" {@attach icon(row.tile)}></span>
		{:else if cover}
			<Cover src={episode.artworkUrl} title={episode.podcastName} />
		{/if}
		<span class="pn-ep-text">
			<span class="pn-ep-title">{episode.title}</span>
			<span class="pn-ep-meta">
				{#if row.current}
					<span class="pn-eq" class:paused={!row.playing}><i></i><i></i><i></i></span>
				{/if}
				{#if row.played}<span {@attach icon("check")}></span>{/if}
				{#if row.source}
					<span class="pod">{row.source}</span><span class="pn-brk"></span>
				{/if}
				{#each row.meta as text, index (index)}
					{#if index || row.source}<span class="sep">·</span>{/if}
					{#if row.progress !== undefined && index === row.meta.length - 1}
						<span class="pn-bar"><span style:width="{row.progress * 100}%"></span></span
						>
					{/if}
					<span>{text}</span>
				{/each}
				{#if row.unavailable}
					<span {@attach icon("cloud-off")}></span>
				{:else if row.downloaded}
					<span title="Downloaded" {@attach icon("arrow-down-to-line")}></span>
				{/if}
				{#if row.hasNote}<span title="Has note" {@attach icon("file-text")}></span>{/if}
			</span>
		</span>
	</button>
	{#if trailing}
		{@render trailing()}
	{:else}
		<button
			type="button"
			class="pn-iconbtn pn-ep-more"
			aria-label="More options for {episode.title}"
			title="More options"
			aria-haspopup="menu"
			onclick={menu}
			oncontextmenu={menu}
			{@attach icon("more-vertical")}
		></button>
	{/if}
</div>
