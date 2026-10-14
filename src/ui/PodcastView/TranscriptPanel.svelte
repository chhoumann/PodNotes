<script lang="ts">
	import { tick } from "svelte";
	import type { Episode } from "src/types/Episode";
	import { formatDuration } from "src/utility/formatDuration";
	import { isLocalFile } from "src/utility/isLocalFile";
	import { getEpisodeMediaType } from "src/utility/mediaType";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Panel from "./Panel.svelte";
	import SearchField from "./SearchField.svelte";
	import { cachedTranscript, lineAt, loadTranscript, type Transcript } from "./transcript";

	type Load =
		| { kind: "loading" }
		| { kind: "error" }
		| { kind: "none" }
		| { kind: "ready"; transcript: Transcript };
	type Line = { readonly start?: number; readonly speaker?: string; readonly text: string };

	let {
		episode,
		position,
		onseek,
	}: {
		episode: Episode;
		position: number;
		onseek(time: number): void;
	} = $props();
	const { feeds, online, settings, saveTranscriptNote, transcribeFromAudio } = useServices();

	let load = $state.raw<Load>({ kind: "loading" });
	let list: HTMLElement | undefined = $state();
	let findButton: HTMLButtonElement | undefined = $state();
	let finding = $state(false);
	let query = $state("");
	let hit = $state(0);
	let following = $state(true);
	/** Where the panel last scrolled its list. A scroll that leaves it elsewhere is the user's. */
	let placed = 0;
	let controller = new AbortController();

	const lines = $derived<readonly Line[]>(load.kind === "ready" ? load.transcript.lines : []);
	const current = $derived(
		load.kind === "ready" && load.transcript.kind === "timed"
			? lineAt(load.transcript.lines, position)
			: -1,
	);
	const needle = $derived(finding ? query.toLowerCase() : "");
	const shown = $derived(
		lines
			.map((line, index) => ({ line, index }))
			.filter(({ line }) => !needle || line.text.toLowerCase().includes(needle)),
	);
	const audio = $derived(getEpisodeMediaType(episode) === "audio");
	const provider = $derived.by(() => {
		const { diarization } = $settings.transcript;
		return diarization?.enabled && diarization.provider === "deepgram" ? "Deepgram" : "OpenAI";
	});

	$effect(() => {
		finding = false;
		query = "";
		following = true;
		show(episode);
		return () => controller.abort();
	});

	$effect(() => {
		if (finding ? needle : following) reveal(finding ? hit : current);
	});

	$effect(() => {
		const scroller = list;
		if (!scroller) return;
		const scrolled = () => {
			if (Math.abs(scroller.scrollTop - placed) > 1) following = false;
		};
		scroller.addEventListener("scroll", scrolled);
		return () => scroller.removeEventListener("scroll", scrolled);
	});

	/** From the cache when it has the episode, so a return to the panel does not flash. */
	function show(target: Episode) {
		controller.abort();
		const cached = cachedTranscript(target);
		if (cached !== undefined) {
			load = cached ? { kind: "ready", transcript: cached } : { kind: "none" };
			return;
		}
		load = { kind: "loading" };
		const { signal } = (controller = new AbortController());
		loadTranscript(feeds, target, signal).then(
			(transcript) => {
				if (!signal.aborted)
					load = transcript ? { kind: "ready", transcript } : { kind: "none" };
			},
			() => {
				if (!signal.aborted) load = { kind: "error" };
			},
		);
	}

	/**
	 * Puts the row a third down the list. Scrolls only the list: scrollIntoView would also
	 * scroll the view and an editor around it.
	 */
	function reveal(at: number) {
		const row = list?.children[at];
		if (!list || !row) return;
		const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
		list.scrollTop += top - list.clientHeight / 3;
		placed = list.scrollTop;
	}

	function seek(time: number) {
		following = true;
		onseek(time);
	}

	function findKey(event: KeyboardEvent) {
		if (event.key !== "Enter" || shown.length === 0) return;
		event.preventDefault();
		hit = (hit + (event.shiftKey ? shown.length - 1 : 1)) % shown.length;
	}

	/** Whether Find was open. Closing it follows the current line again. */
	export function closeFind(): boolean {
		if (!finding) return false;
		finding = false;
		query = "";
		following = true;
		void tick().then(() => findButton?.focus());
		return true;
	}

	/** `text` cut around each match of the query: the odd pieces are the matches. */
	function pieces(text: string): string[] {
		const found: string[] = [];
		const lower = text.toLowerCase();
		let from = 0;
		for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, from)) {
			found.push(text.slice(from, at), text.slice(at, at + needle.length));
			from = at + needle.length;
		}
		found.push(text.slice(from));
		return found;
	}
</script>

<div class="pn-tx">
	<Panel
		head={load.kind === "ready" ? head : undefined}
		list={load.kind === "ready" ? "Transcript" : undefined}
		bind:scroller={list}
	>
		{#if load.kind === "loading"}
			<div class="pn-panel-empty" role="status">Loading transcript</div>
		{:else if load.kind === "error"}
			<div class="pn-panel-empty" role="alert">
				<span class="pn-panel-empty-icon" {@attach icon("alert-triangle")}></span>
				<span>Transcript didn't load</span>
				<button type="button" class="pn-btn" onclick={() => show(episode)}>Retry</button>
			</div>
		{:else if load.kind === "none"}
			<div class="pn-panel-empty">
				<span class="pn-panel-empty-icon" {@attach icon("captions")}></span>
				<span
					>{isLocalFile(episode)
						? "No transcript yet"
						: "No transcript in this feed"}</span
				>
				{#if audio}
					<button
						type="button"
						class="pn-btn"
						disabled={!$online}
						onclick={() => transcribeFromAudio()}
					>
						<span {@attach icon("key")}></span>Transcribe with {provider}
						<span class="pn-tag">Paid</span>
					</button>
				{/if}
			</div>
		{:else if shown.length === 0}
			<li class="pn-panel-empty">No lines match</li>
		{:else}
			{#each shown as { line, index }, at (index)}
				<li>
					{#if line.speaker && line.speaker !== shown[at - 1]?.line.speaker}
						<div class="pn-tx-spk">{line.speaker}</div>
					{/if}
					{#if line.start === undefined}
						<p class="pn-row">{@render text(line.text)}</p>
					{:else}
						{@const start = line.start}
						<button
							type="button"
							class="pn-row"
							class:is-now={index === current}
							class:is-hit={needle && at === hit}
							aria-current={index === current || undefined}
							onclick={() => seek(start)}
						>
							<span class="tm">{formatDuration(start)}</span>
							<span>{@render text(line.text)}</span>
						</button>
					{/if}
				</li>
			{/each}
		{/if}
	</Panel>
	<div class="pn-tx-live" aria-live="polite">
		{#if current >= 0 && !following && !finding}
			<button type="button" class="pn-tx-follow" onclick={() => (following = true)}
				><span {@attach icon("captions")}></span>Follow</button
			>
		{/if}
	</div>
</div>

{#snippet text(value: string)}{#if needle}{#each pieces(value) as piece, i (i)}{#if i % 2}<mark
					>{piece}</mark
				>{:else}{piece}{/if}{/each}{:else}{value}{/if}{/snippet}

{#snippet head()}
	{#if finding}
		<SearchField
			value={query}
			placeholder="Find in transcript"
			autofocus
			oninput={(value) => {
				query = value;
				hit = 0;
			}}
			onkeydown={findKey}
		/>
		<button
			type="button"
			class="pn-iconbtn"
			aria-label="Close find"
			title="Close find"
			onclick={closeFind}
			{@attach icon("x")}
		></button>
	{:else}
		<span class="pn-tx-icon" {@attach icon("rss")}></span>
		<span>Feed transcript</span>
		<span class="pn-tag">Free</span>
		<span class="pn-spacer"></span>
		<button
			type="button"
			class="pn-iconbtn"
			aria-label="Find in transcript"
			title="Find in transcript"
			bind:this={findButton}
			onclick={() => (finding = true)}
			{@attach icon("search")}
		></button>
		<button
			type="button"
			class="pn-btn pn-tx-save"
			aria-label="Save as note"
			title="Save as note"
			disabled={!$online || !audio}
			onclick={() => saveTranscriptNote()}
			><span class="pn-tx-icon" {@attach icon("file-plus")}></span><span>Save as note</span
			></button
		>
	{/if}
{/snippet}

<style>
	.pn-tx {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.pn-tx :global {
		.pn-panel-scroll {
			scroll-behavior: auto;
			overflow-anchor: none;
		}

		.pn-tx-icon {
			display: flex;
			--icon-size: 14px;
		}

		.pn-tag {
			flex: none;
			padding: 1px 6px;
			border-radius: 4px;
			background: var(--background-modifier-border);
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-weight: var(--font-medium);
			line-height: 1.4;
		}

		.pn-panel-head .pn-btn {
			height: 26px;
			padding: 0 var(--size-4-2);
			font-size: var(--font-ui-smaller);
		}

		.pn-panel-head:has(.pn-search) {
			gap: var(--size-2-2);
		}

		.pn-panel-head .pn-input {
			height: 28px;
		}

		.pn-tx-spk {
			margin: var(--size-4-2) 0 2px calc(44px + var(--size-4-3) + var(--size-4-2));
			color: var(--text-muted);
			font-size: var(--font-ui-smaller);
			font-weight: var(--font-semibold);
		}

		p.pn-row {
			margin: 0;
		}

		.pn-row.is-hit {
			box-shadow: inset 0 0 0 1px var(--interactive-accent);
		}

		mark {
			padding: 0 1px;
			border-radius: 2px;
			background: var(--highlight-background, var(--text-highlight-bg));
			color: inherit;
		}

		.pn-tx-live {
			position: absolute;
			left: 50%;
			bottom: var(--size-4-3);
			z-index: 3;
			transform: translateX(-50%);
		}

		.pn-tx-follow {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			height: 28px;
			padding: 0 var(--size-4-3);
			border-radius: 14px;
			background: var(--interactive-accent);
			box-shadow: var(--shadow-s);
			color: var(--text-on-accent);
			font-size: var(--font-ui-smaller);
			font-weight: var(--font-medium);
			--icon-size: 14px;
		}

		.pn-tx-follow:hover {
			background: var(--interactive-accent-hover);
		}
	}

	:global(.is-compact:not(.is-phone)) .pn-tx :global {
		.pn-tx-save {
			width: 28px;
			padding: 0;
		}

		.pn-tx-save span:last-child {
			display: none;
		}
	}

	:global(.is-phone) .pn-tx :global {
		.pn-panel-head .pn-btn {
			height: 40px;
		}

		.pn-panel-head .pn-input {
			height: 40px;
		}

		.pn-tx-follow {
			height: 40px;
			padding: 0 var(--size-4-4);
			border-radius: 20px;
			font-size: var(--font-ui-small);
		}
	}
</style>
