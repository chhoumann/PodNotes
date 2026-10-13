<script lang="ts">
	import { Notice, Scope } from "obsidian";
	import { tick } from "svelte";
	import type { Chapter } from "src/types/Chapter";
	import type { Episode } from "src/types/Episode";
	import { formatDuration } from "src/utility/formatDuration";
	import { isLocalFile } from "src/utility/isLocalFile";
	import { ownRecord } from "src/utility/ownRecord";
	import { normalizeSkipLength } from "src/utility/skipLength";
	import { icon } from "../obsidian/icon";
	import { chapterAt, loadChapters } from "./chapters";
	import ChaptersPanel from "./ChaptersPanel.svelte";
	import { useServices } from "./context";
	import { sourceOf } from "./episodeRow";
	import type { Layout } from "./layout";
	import { anchorOf, episodeMenu, noteEntry, rateMenu, showMenu } from "./menus";
	import type { Page } from "./pages";
	import Scrubber from "./Scrubber.svelte";
	import UpNextPanel from "./UpNextPanel.svelte";

	type Panel = "chapters" | "queue";

	let { viewRoot, layout }: { viewRoot: HTMLElement; layout: Layout } = $props();
	const services = useServices();
	const { app, api, player, navigation, settings, library, rowHasNote, captureTimestamp } =
		services;
	const playerState = player.state;
	const { savedFeeds } = library;
	const id = $props.id();

	let section: HTMLElement | undefined = $state();
	let volumeButton: HTMLButtonElement | undefined = $state();
	let videoFrame: HTMLElement | undefined = $state();
	let inMainWindow = $state(true);
	let chapters: readonly Chapter[] = $state([]);
	/** The panel the user chose. None shows the artwork at compact widths. */
	let panel = $state<Panel>();
	let volumeOpen = $state(false);
	let failedArtworkUrl = $state("");

	const episode = $derived($playerState.episode as Episode);
	const wide = $derived(layout === "wide");
	const playing = $derived(
		$playerState.status === "playing" || $playerState.status === "loading",
	);
	const failed = $derived($playerState.status === "error");
	const video = $derived($playerState.mediaType === "video");
	const duration = $derived($playerState.duration);
	const elapsed = $derived(Math.min($playerState.currentTime, duration));
	const panels = $derived<Panel[]>(chapters.length > 0 ? ["chapters", "queue"] : ["queue"]);
	const shown = $derived(panel && panels.includes(panel) ? panel : wide ? panels[0] : undefined);
	const current = $derived(chapterAt(chapters, elapsed));
	const back = $derived(normalizeSkipLength($settings.skipBackwardLength));
	const forward = $derived(normalizeSkipLength($settings.skipForwardLength));
	const source = $derived(sourceOf(episode));
	const sourcePage = $derived<Page | undefined>(
		isLocalFile(episode)
			? { kind: "local" }
			: ownRecord($savedFeeds)[episode.podcastName]
				? { kind: "feed", key: episode.podcastName }
				: undefined,
	);
	const note = $derived.by(() => {
		// A note made or removed since, also by a capture, changes the store.
		void $rowHasNote;
		return noteEntry(episode, services);
	});
	const chaptersUrl = $derived(episode.chaptersUrl);

	$effect.pre(() => {
		const url = chaptersUrl;
		chapters = [];
		let latest = true;
		if (url) void loadChapters(url).then((loaded) => latest && (chapters = loaded));
		return () => (latest = false);
	});

	$effect(() => {
		if (failed) volumeOpen = false;
	});

	// Obsidian's keymap gives a key to the newest scope, so a menu or modal opened
	// over the player takes Escape first. It keeps one stack per window and pushes
	// onto the active window's, so the scope goes onto the stack of the view's
	// window once that window is active, and moves when the view moves to another
	// window. It is pushed once: pushing it again on a later focus would lift it over
	// a modal opened since. Keys typed elsewhere, as in an editor, stay there.
	$effect(() => {
		const scope = new Scope(app.scope);
		const ours = (evt: KeyboardEvent) => {
			const target = evt.target as Element | null;
			return target === viewRoot.ownerDocument.body || viewRoot.contains(target);
		};
		scope.register(null, "Escape", (evt) => {
			if (!ours(evt)) return true;
			if (volumeOpen) {
				volumeOpen = false;
				volumeButton?.focus();
			} else void collapse();
			return false;
		});
		scope.register(null, " ", (evt) => {
			const target = evt.target as Element | null;
			const control = "input, textarea, select, button, a, [contenteditable], [role=slider]";
			if (!ours(evt) || target?.closest?.(control)) return true;
			player.toggle();
			return false;
		});
		let win = viewRoot.win;
		let pushed = false;
		// Obsidian's own focus listener runs first and makes the window active.
		const push = () => {
			if (pushed || activeWindow !== win) return;
			app.keymap.pushScope(scope);
			pushed = true;
		};
		const pop = () => {
			app.keymap.popScope(scope);
			pushed = false;
		};
		const follow = (next: Window) => {
			win = next;
			// The video plays in the main window, so a popout shows the artwork.
			inMainWindow = next === window;
			win.addEventListener("focus", push);
			push();
		};
		follow(win);
		const stopFollowing = viewRoot.onWindowMigrated((next) => {
			win.removeEventListener("focus", push);
			pop();
			follow(next);
		});
		return () => {
			stopFollowing();
			win.removeEventListener("focus", push);
			pop();
		};
	});

	/** A keyboard user who collapses the player lands on the mini player that opens it again. */
	async function collapse() {
		const hadFocus = !!section?.contains(viewRoot.ownerDocument.activeElement);
		navigation.collapse();
		if (!hadFocus) return;
		await tick();
		viewRoot.querySelector<HTMLElement>(".pn-mini-open")?.focus();
	}

	/** Takes focus unless the player opened while the user works elsewhere, as when a link plays. */
	function focusFromView(button: HTMLButtonElement) {
		const active = button.ownerDocument.activeElement;
		if (!active || active === button.ownerDocument.body || viewRoot.contains(active)) {
			button.focus();
		}
	}

	function closeOutside(popover: HTMLElement) {
		const close = (event: PointerEvent) => {
			const target = event.target as Node;
			if (!popover.contains(target) && !volumeButton?.contains(target)) volumeOpen = false;
		};
		popover.doc.addEventListener("pointerdown", close, true);
		return () => popover.doc.removeEventListener("pointerdown", close, true);
	}

	async function capture() {
		const name = (await captureTimestamp())?.path.split("/").pop()?.replace(/\.md$/, "");
		if (name) new Notice(`Timestamp added to ${name}`);
	}

	function fullscreen() {
		// iOS fullscreens only the media element itself.
		const video = videoFrame?.querySelector("video") as
			| (HTMLVideoElement & { webkitEnterFullscreen?: () => void })
			| null;
		if (videoFrame?.requestFullscreen) void videoFrame.requestFullscreen();
		else video?.webkitEnterFullscreen?.();
	}
</script>

{#snippet panelView(kind: Panel)}
	{#if kind === "chapters"}
		<ChaptersPanel
			{chapters}
			position={elapsed}
			onseek={(time) => {
				player.seek(time);
				player.resume();
			}}
		/>
	{:else}
		<UpNextPanel />
	{/if}
{/snippet}

{#snippet choices(tabs: boolean)}
	{#each panels as kind (kind)}
		<button
			type="button"
			class={tabs ? "pn-tab" : "pn-sw"}
			role={tabs ? "tab" : undefined}
			aria-selected={tabs ? shown === kind : undefined}
			aria-pressed={tabs ? undefined : shown === kind}
			onclick={() => (panel = !tabs && shown === kind ? undefined : kind)}
			>{kind === "chapters" ? "Chapters" : "Up next"}</button
		>
	{/each}
{/snippet}

<section class="pn-player" class:is-wide={wide} aria-labelledby="{id}-name" bind:this={section}>
	<span id="{id}-name" hidden>Player</span>
	<header class="pn-np-head">
		<button
			type="button"
			class="pn-iconbtn"
			aria-label="Collapse player"
			title="Collapse player"
			onclick={collapse}
			{@attach icon("chevron-down")}
			{@attach focusFromView}
		></button>
		<span class="pn-spacer"></span>
		<button
			type="button"
			class="pn-iconbtn"
			aria-label="Episode options"
			title="Episode options"
			aria-haspopup="menu"
			onclick={(event) => {
				const at = anchorOf(event);
				showMenu(episodeMenu(episode, services, { place: "player", at }), at);
			}}
			{@attach icon("more-horizontal")}
		></button>
	</header>
	<div class="pn-np-body">
		<div class="pn-np-left">
			<div class="pn-stage">
				{#if !wide && shown}
					{@render panelView(shown)}
				{:else if failed}
					<div class="pn-np-err" role="alert">
						<span class="pn-np-err-icon" {@attach icon("alert-triangle")}></span>
						<span>Could not load this episode's media.</span>
						<button type="button" class="pn-btn" onclick={() => player.resume()}
							>Retry</button
						>
					</div>
				{:else if video && inMainWindow}
					<div class="pn-video" use:player.videoStage bind:this={videoFrame}>
						<button
							type="button"
							class="pn-fs"
							aria-label="Fullscreen"
							title="Fullscreen"
							onclick={fullscreen}
							{@attach icon("maximize")}
						></button>
					</div>
				{:else if episode.artworkUrl && episode.artworkUrl !== failedArtworkUrl}
					<img
						class="pn-np-art"
						src={episode.artworkUrl}
						alt=""
						onerror={() => (failedArtworkUrl = episode.artworkUrl ?? "")}
					/>
				{:else}
					<span class="pn-np-art pn-filetile" {@attach icon(video ? "video" : "music")}
					></span>
				{/if}
			</div>
			<div class="pn-deck">
				<div class="pn-tb">
					<h2 class="pn-np-title" title={episode.title}>{episode.title}</h2>
					{#if sourcePage}
						{@const page = sourcePage}
						<button type="button" class="pn-np-pod" onclick={() => navigation.go(page)}
							>{source}</button
						>
					{:else}
						<span class="pn-np-pod">{source}</span>
					{/if}
				</div>
				<div class="pn-scrubwrap">
					<Scrubber
						position={elapsed}
						{duration}
						{chapters}
						disabled={failed}
						onseek={(time) => player.seek(time)}
					/>
					<div class="pn-times">
						<span>{formatDuration(elapsed)}</span>
						{#if current >= 0}
							<button
								type="button"
								class="pn-chapnow"
								title="Chapters"
								onclick={() => (panel = "chapters")}
								>{chapters[current].title}</button
							>
						{:else}
							<span></span>
						{/if}
						<span class="r">-{formatDuration(Math.max(0, duration - elapsed))}</span>
					</div>
				</div>
				<div class="pn-transport">
					<button
						type="button"
						class="pn-rate"
						aria-label="Playback speed {$playerState.playbackRate}x"
						aria-haspopup="menu"
						disabled={failed}
						onclick={(event) => showMenu(rateMenu(services), anchorOf(event))}
						><span>{$playerState.playbackRate}×</span></button
					>
					<div class="mid">
						<button
							type="button"
							class="pn-skip"
							aria-label="Back {back} seconds"
							title="Back {back} seconds"
							disabled={failed}
							onclick={() => api.skipBackward()}
						>
							<span {@attach icon("rotate-ccw")}></span><b>{back}</b>
						</button>
						<button
							type="button"
							class="pn-play"
							aria-label={playing ? "Pause" : "Play"}
							title={playing ? "Pause" : "Play"}
							disabled={failed}
							onclick={() => player.toggle()}
							{@attach icon(playing ? "pause" : "play")}
						></button>
						<button
							type="button"
							class="pn-skip"
							aria-label="Forward {forward} seconds"
							title="Forward {forward} seconds"
							disabled={failed}
							onclick={() => api.skipForward()}
						>
							<span {@attach icon("rotate-cw")}></span><b>{forward}</b>
						</button>
					</div>
					<button
						type="button"
						class="pn-vol"
						aria-label="Volume {Math.round($playerState.volume * 100)}%"
						title="Volume"
						aria-expanded={volumeOpen}
						disabled={failed}
						bind:this={volumeButton}
						onclick={() => (volumeOpen = !volumeOpen)}
						{@attach icon($playerState.volume > 0 ? "volume-2" : "volume-x")}
					></button>
					{#if volumeOpen}
						<div class="pn-pop" {@attach closeOutside}>
							<input
								type="range"
								min="0"
								max="1"
								step="0.05"
								value={$playerState.volume}
								aria-label="Volume"
								oninput={(event) =>
									player.setVolume(Number(event.currentTarget.value))}
							/>
							<span>{Math.round($playerState.volume * 100)}%</span>
						</div>
					{/if}
				</div>
				<div class="pn-capture">
					<button
						type="button"
						class="pn-btn mod-cta pn-cap"
						aria-label="Capture timestamp"
						onclick={capture}
					>
						<span {@attach icon("clock-plus")}></span><span>Timestamp</span>
					</button>
					<button type="button" class="pn-btn pn-cap" onclick={() => note.onClick()}>
						<span {@attach icon(note.icon)}></span><span>{note.title}</span>
					</button>
				</div>
				{#if !wide}
					<div class="pn-switch" role="group" aria-label="Player panels">
						{@render choices(false)}
					</div>
				{/if}
			</div>
		</div>
		{#if wide && shown}
			<div class="pn-np-right">
				<div class="pn-tabs" role="tablist" aria-label="Player panels">
					{@render choices(true)}
				</div>
				<div class="pn-panelwrap" role="tabpanel">{@render panelView(shown)}</div>
			</div>
		{/if}
	</div>
</section>

<style>
	.pn-player {
		position: absolute;
		inset: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		background: var(--pn-bg);
	}

	.pn-np-head {
		flex: none;
		display: flex;
		align-items: center;
		height: var(--pn-head);
		padding: 0 var(--size-4-2);
	}

	.pn-np-body {
		flex: 1;
		min-height: 0;
		display: flex;
		padding-bottom: var(--pn-status-bar);
	}

	/* A short view scrolls the player, so neither the artwork nor a video shrinks to nothing. */
	.pn-np-left {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		overflow-y: auto;
	}

	.pn-stage {
		flex: 1 0 auto;
		min-height: 160px;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 var(--pn-pad);
		container-type: size;
	}

	.pn-np-art {
		flex: none;
		width: min(100cqw, 100cqh - 8px, 300px);
		aspect-ratio: 1;
		border-radius: 12px;
		box-shadow: var(--shadow-s);
		object-fit: cover;
	}

	:global(.is-phone) .pn-np-art {
		width: min(100cqw, 100cqh - 8px, 358px);
	}

	.pn-stage .pn-np-art.pn-filetile {
		color: var(--text-faint);
		container-type: inline-size;
		--icon-size: 25cqw;
		--icon-stroke: 1.25px;
	}

	.pn-np-err {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--size-4-3);
		color: var(--text-muted);
		text-align: center;
	}

	.pn-np-err-icon {
		display: flex;
		color: var(--text-error);
		--icon-size: 28px;
	}

	.pn-video {
		position: relative;
		width: 100cqw;
		max-height: 100cqh;
		aspect-ratio: 16 / 9;
		border-radius: var(--radius-m);
		overflow: hidden;
	}

	.pn-video :global(video) {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.pn-player .pn-fs {
		position: absolute;
		right: 8px;
		bottom: 8px;
		z-index: 1;
		width: 32px;
		height: 32px;
		padding: 0;
		background: var(--background-primary);
		box-shadow: var(--shadow-s);
		--icon-size: 16px;
	}

	.pn-deck {
		flex: none;
		display: flex;
		flex-direction: column;
		gap: var(--size-4-3);
		padding: var(--size-4-3) var(--pn-pad);
	}

	.pn-tb {
		min-width: 0;
		text-align: center;
	}

	.pn-np-title {
		margin: 0;
		font-size: var(--font-ui-medium);
		font-weight: var(--font-semibold);
		line-height: 1.3;
		letter-spacing: -0.005em;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}

	.pn-player .pn-np-pod,
	.pn-player .pn-chapnow {
		display: inline-block;
		max-width: 100%;
		height: auto;
		padding: 1px var(--size-2-3);
		border-radius: var(--radius-s);
		background: none;
		box-shadow: none;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.pn-np-pod {
		margin-top: var(--size-2-2);
		vertical-align: top;
	}

	.pn-player button.pn-np-pod:hover,
	.pn-player .pn-chapnow:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.pn-scrubwrap {
		display: flex;
		flex-direction: column;
		gap: var(--size-2-2);
	}

	.pn-times {
		display: grid;
		grid-template-columns: 1fr minmax(0, auto) 1fr;
		align-items: center;
		gap: var(--size-4-2);
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		font-variant-numeric: tabular-nums;
	}

	.pn-player .pn-chapnow {
		min-width: 0;
		font-size: inherit;
	}

	.r {
		text-align: right;
	}

	.pn-transport {
		position: relative;
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
	}

	.mid {
		display: flex;
		align-items: center;
		gap: var(--size-4-3);
	}

	.pn-player :is(.pn-rate, .pn-skip, .pn-vol, .pn-play) {
		padding: 0;
		background: none;
		box-shadow: none;
	}

	.pn-player .pn-rate {
		justify-self: start;
		min-width: 44px;
		height: var(--pn-skip);
	}

	.pn-rate span {
		display: inline-flex;
		align-items: center;
		height: 24px;
		padding: 0 var(--size-4-2);
		border: 1px solid var(--background-modifier-border-hover);
		border-radius: 12px;
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		font-weight: var(--font-semibold);
		font-variant-numeric: tabular-nums;
	}

	.pn-rate:hover span {
		border-color: var(--background-modifier-border-focus);
		color: var(--text-normal);
	}

	:global(.is-phone) .pn-rate span {
		height: 30px;
		padding: 0 var(--size-4-3);
		border-radius: 15px;
	}

	.pn-player :is(.pn-skip, .pn-vol) {
		position: relative;
		width: var(--pn-skip);
		height: var(--pn-skip);
		border-radius: 50%;
	}

	.pn-player :is(.pn-skip, .pn-vol):hover {
		background: var(--background-modifier-hover);
	}

	.pn-skip {
		--icon-size: 26px;
		--icon-stroke: 1.6px;
	}

	.pn-skip span {
		display: flex;
	}

	.pn-skip b {
		position: absolute;
		left: 0;
		right: 0;
		top: 50%;
		transform: translateY(-38%);
		font-size: 8.5px;
		letter-spacing: -0.02em;
	}

	:global(.is-phone) .pn-skip {
		--icon-size: 30px;
	}

	:global(.is-phone) .pn-skip b {
		font-size: 10px;
	}

	.pn-player .pn-play {
		width: var(--pn-play);
		height: var(--pn-play);
		border-radius: 50%;
		background: var(--text-normal);
		color: var(--pn-bg);
		transition: transform 120ms ease;
		--icon-size: calc(var(--pn-play) * 0.4);
	}

	.pn-play :global(svg) {
		fill: currentColor;
	}

	.pn-play :global(.lucide-play) {
		margin-left: 6%;
	}

	.pn-play:active {
		transform: scale(0.95);
	}

	.pn-player .pn-vol {
		justify-self: end;
		color: var(--text-muted);
		--icon-size: 20px;
	}

	.pn-player :is(.pn-rate, .pn-skip, .pn-vol, .pn-play):disabled {
		opacity: 0.35;
	}

	.pn-pop {
		position: absolute;
		right: 0;
		bottom: calc(100% + 6px);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: var(--size-4-2);
		padding: var(--size-4-2) var(--size-4-3);
		border: 1px solid var(--background-modifier-border-hover);
		border-radius: var(--radius-m);
		background: var(--background-primary);
		box-shadow: var(--shadow-s);
		color: var(--text-muted);
		font-size: var(--font-ui-smaller);
		font-variant-numeric: tabular-nums;
	}

	.pn-pop input {
		width: 120px;
	}

	.pn-pop span {
		min-width: 4ch;
		text-align: right;
	}

	.pn-capture {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--size-4-2);
	}

	.pn-player .pn-cap {
		min-width: 0;
		height: var(--pn-cap-h);
		font-weight: var(--font-medium);
		--icon-size: 17px;
	}

	.pn-cap span {
		display: flex;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	:global(.is-phone) .pn-cap {
		--icon-size: 20px;
	}

	.pn-switch {
		display: flex;
		justify-content: center;
		gap: var(--size-2-2);
	}

	.pn-player :is(.pn-sw, .pn-tab) {
		padding: 0 var(--size-4-3);
		background: none;
		box-shadow: none;
		color: var(--text-muted);
		font-weight: var(--font-medium);
	}

	.pn-player .pn-sw {
		height: 28px;
		border-radius: 14px;
		font-size: var(--font-ui-smaller);
	}

	.pn-player .pn-sw:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.pn-player .pn-sw[aria-pressed="true"] {
		background: var(--background-modifier-border);
		color: var(--text-normal);
	}

	:global(.is-phone) .pn-player .pn-sw {
		height: 44px;
		border-radius: 22px;
		padding: 0 var(--size-4-4);
	}

	:global(.is-phone) .pn-deck {
		gap: var(--size-4-4);
		padding-bottom: var(--size-4-2);
	}

	.is-wide .pn-np-head {
		padding: 0 var(--size-4-3);
	}

	.is-wide .pn-np-body {
		display: grid;
		grid-template-columns: 360px minmax(0, 1fr);
	}

	.is-wide .pn-np-left {
		padding-bottom: var(--size-4-4);
	}

	.is-wide .pn-stage {
		padding: var(--size-4-1) var(--size-4-6) 0;
	}

	.is-wide .pn-deck {
		gap: var(--size-4-4);
		padding: var(--size-4-4) var(--size-4-6) 0;
	}

	.is-wide .pn-np-title {
		font-size: var(--font-ui-large);
		line-height: 1.25;
		letter-spacing: -0.01em;
		-webkit-line-clamp: 3;
		line-clamp: 3;
	}

	.pn-np-right {
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-left: 1px solid var(--background-modifier-border);
	}

	.pn-tabs {
		flex: none;
		display: flex;
		gap: var(--size-4-5);
		padding: 0 var(--size-4-6);
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.pn-player .pn-tab {
		position: relative;
		height: 40px;
		padding: 0;
		border-radius: 0;
	}

	.pn-player .pn-tab:hover,
	.pn-player .pn-tab[aria-selected="true"] {
		background: none;
		color: var(--text-normal);
	}

	.pn-tab[aria-selected="true"]::after {
		content: "";
		position: absolute;
		left: 0;
		right: 0;
		bottom: -1px;
		height: 2px;
		border-radius: 1px;
		background: var(--interactive-accent);
	}

	.pn-panelwrap {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
