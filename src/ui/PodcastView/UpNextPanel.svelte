<script lang="ts">
	import { useServices } from "./context";
	import { formatMinutes, secondsLeft } from "./episodeRow";
	import QueueList from "./QueueList.svelte";

	const { library, navigation } = useServices();
	const { queue, playedEpisodes } = library;
	const count = $derived($queue.episodes.length);
</script>

<div class="pn-panel">
	{#if count > 0}
		<div class="pn-panel-head">
			<span>
				{count}
				{count === 1 ? "episode" : "episodes"} · {formatMinutes(
					secondsLeft($queue.episodes, $playedEpisodes),
				)}
			</span>
			<span class="pn-spacer"></span>
			<button
				type="button"
				class="pn-textbtn"
				onclick={() => navigation.go({ kind: "queue" })}>Edit</button
			>
		</div>
	{/if}
	<div class="pn-panel-scroll"><QueueList empty="Queue is empty" /></div>
</div>
