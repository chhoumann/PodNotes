<script lang="ts">
	import { tick } from "svelte";
	import type { Episode } from "src/types/Episode";
	import { formatDuration } from "src/utility/formatDuration";
	import { isLocalFile } from "src/utility/isLocalFile";
	import { getEpisodeTranscriptPath } from "src/utility/getEpisodeTranscriptPath";
	import { getEpisodeMediaType } from "src/utility/mediaType";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import Panel from "./Panel.svelte";
	import SearchField from "./SearchField.svelte";
	import {
		cachedTranscript,
		foldCase,
		lineAt,
		loadTranscript,
		type Transcript,
	} from "./transcript";

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
	const { app, feeds, online, settings, rowHasNote, saveTranscriptNote, transcribeFromAudio } =
		useServices();

	let load = $state.raw<Load>({ kind: "loading" });
	let list: HTMLElement | undefined = $state();
	let findButton: HTMLButtonElement | undefined = $state();
	let finding = $state(false);
	let query = $state("");
	let hit = $state(0);
	let following = $state(true);
	let ownScrollTop = 0;
	let controller = new AbortController();

	const lines = $derived<readonly Line[]>(load.kind === "ready" ? load.transcript.lines : []);
	const current = $derived(
		load.kind === "ready" && load.transcript.kind === "timed"
			? lineAt(load.transcript.lines, position)
			: -1,
	);
	const needle = $derived(finding ? foldCase(query) : "");
	const shown = $derived(
		lines
			.map((line, index) => ({ line, index }))
			.filter(({ line }) => !needle || foldCase(line.text).includes(needle)),
	);
	const audio = $derived(getEpisodeMediaType(episode) === "audio");
	// The note saved before, which the command would refuse to save again. A note made, moved or
	// deleted since changes rowHasNote, and the transcript path is a setting.
	const note = $derived.by(() => {
		void $rowHasNote;
		return app.vault.getFileByPath(
			getEpisodeTranscriptPath(episode, $settings.transcript.path),
		);
	});
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
		// A resize that lowers the list's last scroll position moves it without the reader.
		const scrolled = () => {
			const own = Math.min(ownScrollTop, scroller.scrollHeight - scroller.clientHeight);
			if (Math.abs(scroller.scrollTop - own) > 1) following = false;
		};
		scroller.addEventListener("scroll", scrolled);
		return () => scroller.removeEventListener("scroll", scrolled);
	});

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

	/** Not scrollIntoView, which would also scroll the view and an editor around it. */
	function reveal(at: number) {
		const row = list?.children[at];
		if (!list || !row) return;
		const top = row.getBoundingClientRect().top - list.getBoundingClientRect().top;
		list.scrollTop += top - list.clientHeight / 3;
		ownScrollTop = list.scrollTop;
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

	/** Closes Find and returns whether it was open. */
	export function closeFind(): boolean {
		if (!finding) return false;
		finding = false;
		query = "";
		following = true;
		void tick().then(() => findButton?.focus());
		return true;
	}

	function pieces(text: string): string[] {
		const found: string[] = [];
		const lower = foldCase(text);
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
		{:else if load.kind !== "ready"}
			{@const failed = load.kind === "error"}
			<div class="pn-panel-empty" role={failed ? "alert" : undefined}>
				<span
					class="pn-panel-empty-icon"
					{@attach icon(failed ? "alert-triangle" : "captions")}
				></span>
				<span
					>{failed
						? "Transcript didn't load"
						: isLocalFile(episode)
							? "No transcript yet"
							: "No transcript in this feed"}</span
				>
				{#if failed}
					<button type="button" class="pn-btn" onclick={() => show(episode)}>Retry</button
					>
				{/if}
				{#if note}
					{@render saveNote()}
				{:else if !failed && audio}
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
						<p class="pn-row" class:is-hit={needle && at === hit}>
							{@render text(line.text)}
						</p>
					{:else}
						{@const start = line.start}
						<button
							type="button"
							class="pn-bare pn-row"
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
			bind:this={findButton}
			onclick={() => (finding = true)}
			{@attach icon("search")}
		></button>
		{@render saveNote()}
	{/if}
{/snippet}

{#snippet saveNote()}
	{@const label = note ? "Open note" : "Save as note"}
	<button
		type="button"
		class="pn-btn pn-tx-save"
		aria-label={label}
		disabled={!note && !$online}
		onclick={() => (note ? app.workspace.getLeaf(false).openFile(note) : saveTranscriptNote())}
		><span class="pn-tx-icon" {@attach icon(note ? "file-text" : "file-plus")}></span><span
			>{label}</span
		></button
	>
{/snippet}

<style>
	.pn-tx :global {
		position: relative;
		width: 100%;
		height: 100%;

		/* Following compares exact scroll positions, so the list must not animate them. */
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
			display: block;
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

		@media (hover: hover) {
			.pn-tx-follow:hover {
				background: var(--interactive-accent-hover);
			}
		}

		/* Save keeps its label where the head has room for it, wherever the panel is. */
		.pn-panel-head {
			container-type: inline-size;

			@container (width < 340px) {
				.pn-tx-save {
					width: 28px;
					padding: 0;
				}

				.pn-tx-save span:last-child {
					display: none;
				}
			}
		}

		.is-phone & .pn-tx-follow {
			height: 44px;
			padding: 0 var(--size-4-4);
			border-radius: 22px;
			font-size: var(--font-ui-small);
		}
	}
</style>
