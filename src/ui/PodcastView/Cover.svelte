<script lang="ts">
	import { icon } from "../obsidian/icon";

	let {
		src,
		title,
		tile,
	}: {
		src: string | undefined;
		title: string;
		/** A local file's tile, in place of artwork. */
		tile?: "music" | "video";
	} = $props();
	let failed = $state<string>();
</script>

{#if tile}
	<span class="pn-cover pn-filetile" {@attach icon(tile)}></span>
{:else if src && src !== failed}
	<img
		class="pn-cover"
		{src}
		alt=""
		loading="lazy"
		draggable="false"
		onerror={() => (failed = src)}
	/>
{:else}
	<span class="pn-cover is-text" aria-hidden="true"><span>{title}</span></span>
{/if}

<style>
	.pn-cover :global {
		display: block;
		flex: none;
		width: 100%;
		aspect-ratio: 1;
		border-radius: 6px;
		object-fit: cover;

		&.is-text {
			display: flex;
			align-items: flex-end;
			overflow: hidden;
			background: var(--background-modifier-border);
			color: var(--text-muted);
			font-weight: var(--font-bold);
			line-height: 1;
			text-align: left;
			overflow-wrap: anywhere;
			container-type: inline-size;

			/* cqw is the cover's width. A percentage padding on the cover is its row's. Three
			   lines keep a long title's beginning, at a size a row's small cover can show. */
			> span {
				display: -webkit-box;
				-webkit-line-clamp: 3;
				line-clamp: 3;
				-webkit-box-orient: vertical;
				overflow: hidden;
				padding: 10cqw;
				font-size: max(10px, 12cqw);
			}
		}
	}
</style>
