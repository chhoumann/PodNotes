<script lang="ts">
	import { useServices } from "./context";
	import { formatMinutes, secondsLeft } from "./episodeRow";
	import Panel from "./Panel.svelte";
	import QueueList from "./QueueList.svelte";

	const { library, navigation } = useServices();
	const { queue, playedEpisodes } = library;
	const count = $derived($queue.episodes.length);
</script>

<Panel head={count > 0 ? head : undefined}>
	<QueueList empty="Queue is empty" />
</Panel>

{#snippet head()}
	<span>
		{count}
		{count === 1 ? "episode" : "episodes"} · {formatMinutes(
			secondsLeft($queue.episodes, $playedEpisodes),
		)}
	</span>
	<span class="pn-spacer"></span>
	<button type="button" class="pn-textbtn" onclick={() => navigation.go({ kind: "queue" })}
		>Edit</button
	>
{/snippet}

<style>
	.pn-textbtn {
		height: auto;
		padding: var(--size-2-2) var(--size-4-2);
		border-radius: var(--radius-s);
		background: none;
		box-shadow: none;
		color: var(--text-accent);
		font-size: var(--font-ui-small);
		font-weight: var(--font-medium);
	}

	.pn-textbtn:hover {
		background: var(--background-modifier-hover);
	}
</style>
