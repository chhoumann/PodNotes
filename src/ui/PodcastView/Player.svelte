<script lang="ts">
	import { tick } from "svelte";
	import type { Chapter } from "src/types/Chapter";
	import type { Episode } from "src/types/Episode";
	import { icon } from "../obsidian/icon";
	import { cachedChapters, loadChapters } from "./chapters";
	import ChaptersPanel from "./ChaptersPanel.svelte";
	import { useServices } from "./context";
	import Cover from "./Cover.svelte";
	import Deck from "./Deck.svelte";
	import { isPlaying } from "src/player/PlayerController";
	import { tileOf } from "./episodeRow";
	import type { Layout } from "./layout";
	import { anchorOf, episodeMenu, showMenu } from "./menus";
	import TranscriptPanel from "./TranscriptPanel.svelte";
	import UpNextPanel from "./UpNextPanel.svelte";

	type PanelKind = "chapters" | "transcript" | "queue";

	const PANEL_LABELS: Record<PanelKind, string> = {
		chapters: "Chapters",
		transcript: "Transcript",
		queue: "Up next",
	};

	/** Arrow keys, Home and End move between the wide player's tabs, each showing its panel. */
	const TAB_KEYS: Record<string, (at: number, count: number) => number> = {
		ArrowLeft: (at, count) => (at + count - 1) % count,
		ArrowRight: (at, count) => (at + 1) % count,
		Home: () => 0,
		End: (_at, count) => count - 1,
	};

	let { viewRoot, layout }: { viewRoot: HTMLElement; layout: Layout } = $props();
	const services = useServices();
	const { player, navigation, scope } = services;
	const playerState = player.state;
	const id = $props.id();

	let section: HTMLElement | undefined = $state();
	let deck: Deck | undefined = $state();
	let transcript: TranscriptPanel | undefined = $state();
	let videoFrame: HTMLElement | undefined = $state();
	let inMainWindow = $state(true);
	let isFullscreen = $state(false);
	let chapters: readonly Chapter[] = $state([]);
	/** The panel the user chose. None shows the artwork at compact widths. */
	let panel = $state<PanelKind>();

	const episode = $derived($playerState.episode as Episode);
	const wide = $derived(layout === "wide");
	const playing = $derived(isPlaying($playerState.status));
	const failed = $derived($playerState.status === "error");
	const video = $derived($playerState.mediaType === "video");
	const elapsed = $derived(Math.min($playerState.currentTime, $playerState.duration));
	const panels = $derived<PanelKind[]>(
		chapters.length > 0 ? ["chapters", "transcript", "queue"] : ["transcript", "queue"],
	);
	const shown = $derived.by(() => {
		// At compact widths a media error takes the stage, so no panel shows meanwhile.
		if (failed && !wide) return undefined;
		if (panel && panels.includes(panel)) return panel;
		return wide ? panels.find((kind) => kind !== "transcript") : undefined;
	});
	const chaptersUrl = $derived(episode.chaptersUrl);

	$effect.pre(() => {
		const url = chaptersUrl;
		// A choice of Chapters belongs to the episode it was made on.
		panel = undefined;
		const cached = url && cachedChapters(url);
		chapters = cached || [];
		if (!url || cached) return;
		let latest = true;
		void loadChapters(url).then((loaded) => latest && (chapters = loaded));
		return () => (latest = false);
	});

	// The view's own scope gets the keys typed while the view's leaf is active, which focus
	// or a press in the view makes it. A menu or modal over the player takes Escape first.
	$effect(() => {
		const escape = scope.register(null, "Escape", () => {
			// The first Escape leaves a video's fullscreen, which Obsidian's window keeps otherwise.
			if (isFullscreen) void viewRoot.doc.exitFullscreen();
			else if (!deck?.closeVolume() && !transcript?.closeFind()) void collapse();
			return false;
		});
		const space = scope.register(null, " ", (evt) => {
			const control = "input, textarea, select, button, a, [contenteditable], [role=slider]";
			if ((evt.target as Element | null)?.closest?.(control)) return true;
			player.toggle();
			return false;
		});
		return () => {
			scope.unregister(escape);
			scope.unregister(space);
		};
	});

	$effect(() => {
		// The video plays in the main window, so a popout shows the artwork.
		const follow = (win: Window) => (inMainWindow = win === window);
		follow(viewRoot.win);
		return viewRoot.onWindowMigrated(follow);
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

	function moveTab(event: KeyboardEvent, at: number) {
		const step = TAB_KEYS[event.key];
		if (!step) return;
		event.preventDefault();
		const index = step(at, panels.length);
		panel = panels[index];
		const tab = (event.currentTarget as HTMLElement).parentElement?.children[index];
		(tab as HTMLElement | undefined)?.focus();
	}

	function playFrom(time: number) {
		player.seek(time);
		player.resume();
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

<!-- Also when the frame goes, as when the next episode in the queue is audio. -->
<svelte:document
	onfullscreenchange={() =>
		(isFullscreen = !!videoFrame && viewRoot.doc.fullscreenElement === videoFrame)}
/>

{#snippet panelView(kind: PanelKind)}
	{#if kind === "chapters"}
		<ChaptersPanel {chapters} position={elapsed} onseek={playFrom} />
	{:else if kind === "transcript"}
		<TranscriptPanel bind:this={transcript} {episode} position={elapsed} onseek={playFrom} />
	{:else}
		<UpNextPanel />
	{/if}
{/snippet}

{#snippet tabs()}
	<div class="pn-tabs" role="tablist" aria-label="Player panels">
		{#each panels as kind, index (kind)}
			<button
				type="button"
				id="{id}-{kind}"
				class="pn-bare pn-tab"
				role="tab"
				aria-selected={shown === kind}
				aria-controls="{id}-panel"
				tabindex={shown === kind ? 0 : -1}
				onclick={() => (panel = kind)}
				onkeydown={(event) => moveTab(event, index)}>{PANEL_LABELS[kind]}</button
			>
		{/each}
	</div>
{/snippet}

{#snippet switcher()}
	<div class="pn-switch" role="group" aria-label="Player panels">
		{#each panels as kind (kind)}
			<button
				type="button"
				class="pn-bare pn-sw"
				aria-pressed={shown === kind}
				disabled={failed}
				onclick={() => (panel = shown === kind ? undefined : kind)}
				>{PANEL_LABELS[kind]}</button
			>
		{/each}
	</div>
{/snippet}

<section class="pn-player" class:is-wide={wide} aria-labelledby="{id}-name" bind:this={section}>
	<span id="{id}-name" hidden>Player</span>
	<header class="pn-np-head">
		<button
			type="button"
			class="pn-iconbtn"
			aria-label="Collapse player"
			onclick={collapse}
			{@attach icon("chevron-down")}
			{@attach focusFromView}
		></button>
		<span class="pn-spacer"></span>
		<button
			type="button"
			class="pn-iconbtn"
			aria-label="Episode options"
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
				{#if failed}
					<div class="pn-np-err" role="alert">
						<span class="pn-np-err-icon" {@attach icon("alert-triangle")}></span>
						<span>Could not load this episode's media.</span>
						<button type="button" class="pn-btn" onclick={() => player.resume()}
							>Retry</button
						>
					</div>
				{:else if !wide && shown}
					{@render panelView(shown)}
				{:else if video && inMainWindow}
					<div class="pn-video" use:player.videoStage bind:this={videoFrame}>
						<button
							type="button"
							class="pn-bare pn-vplay"
							class:is-paused={!playing}
							aria-label={playing ? "Pause" : "Play"}
							onclick={() => player.toggle()}
							><span {@attach icon(playing ? "pause" : "play")}></span></button
						>
						<button
							type="button"
							class="pn-fs"
							aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
							onclick={() =>
								isFullscreen ? viewRoot.doc.exitFullscreen() : fullscreen()}
							{@attach icon(isFullscreen ? "minimize" : "maximize")}
						></button>
					</div>
				{:else}
					<Cover
						src={episode.artworkUrl}
						title={episode.podcastName}
						tile={tileOf(episode)}
					/>
				{/if}
			</div>
			<Deck
				bind:this={deck}
				{chapters}
				onchapters={failed && !wide ? undefined : () => (panel = "chapters")}
			>
				{#if !wide}
					{@render switcher()}
				{/if}
			</Deck>
		</div>
		{#if wide && shown}
			<div class="pn-np-right">
				{@render tabs()}
				<div
					class="pn-panelwrap"
					id="{id}-panel"
					role="tabpanel"
					aria-labelledby="{id}-{shown}"
				>
					{@render panelView(shown)}
				</div>
			</div>
		{/if}
	</div>
</section>

<style>
	.pn-player :global {
		position: absolute;
		inset: 0;
		z-index: 10;
		display: flex;
		flex-direction: column;
		background: var(--pn-bg);

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

		/* The stage's own artwork, not the covers of a panel's rows shown in it. */
		.pn-stage > .pn-cover {
			width: min(100cqw, 100cqh - 8px, 300px);
			border-radius: 12px;
			box-shadow: var(--shadow-s);
		}

		.pn-stage > .pn-filetile {
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

		.pn-video video {
			display: block;
			width: 100%;
			height: 100%;
			object-fit: contain;
		}

		/* Fullscreen shows this frame alone, so it carries its own play and pause. */
		.pn-vplay {
			position: absolute;
			inset: 0;
			width: auto;
			height: auto;
			padding: 0;
			border-radius: 0;
			opacity: 0;
		}

		.pn-vplay:focus-visible {
			outline-offset: -2px;
		}

		.pn-vplay.is-paused,
		.pn-vplay:focus-visible {
			opacity: 1;
		}

		.pn-vplay span {
			display: flex;
			padding: var(--size-4-3);
			border-radius: 50%;
			background: var(--background-primary);
			box-shadow: var(--shadow-s);
			color: var(--text-normal);
			--icon-size: 24px;
		}

		.pn-fs {
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

		.pn-np-right {
			min-height: 0;
			display: flex;
			flex-direction: column;
			border-left: 1px solid var(--background-modifier-border);
		}

		.pn-panelwrap {
			flex: 1;
			min-height: 0;
			display: flex;
			flex-direction: column;
		}

		.pn-switch {
			display: flex;
			justify-content: center;
			gap: var(--size-2-2);
		}

		:is(.pn-sw, .pn-tab) {
			padding: 0 var(--size-4-3);
			color: var(--text-muted);
			font-weight: var(--font-medium);
		}

		.pn-sw {
			height: 28px;
			border-radius: 14px;
			font-size: var(--font-ui-smaller);
		}

		.pn-sw[aria-pressed="true"] {
			background: var(--background-modifier-border);
			color: var(--text-normal);
		}

		.pn-tabs {
			flex: none;
			display: flex;
			gap: var(--size-4-5);
			padding: 0 var(--size-4-6);
			border-bottom: 1px solid var(--background-modifier-border);
		}

		.pn-tab {
			position: relative;
			height: 40px;
			padding: 0;
			border-radius: 0;
		}

		.pn-tab[aria-selected="true"] {
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

		@media (hover: hover) {
			.pn-video:hover .pn-vplay {
				opacity: 1;
			}

			.pn-sw:hover:not(:disabled) {
				background: var(--background-modifier-hover);
				color: var(--text-normal);
			}

			.pn-tab:hover {
				color: var(--text-normal);
			}
		}

		.is-phone & {
			.pn-stage > .pn-cover {
				width: min(100cqw, 100cqh - 8px, 358px);
			}

			.pn-sw {
				height: 44px;
				border-radius: 22px;
				padding: 0 var(--size-4-4);
			}
		}

		&.is-wide {
			.pn-np-head {
				padding: 0 var(--size-4-3);
			}

			.pn-np-body {
				display: grid;
				grid-template-columns: 360px minmax(0, 1fr);
			}

			.pn-np-left {
				padding-bottom: var(--size-4-4);
			}

			.pn-stage {
				padding: var(--size-4-1) var(--size-4-6) 0;
			}
		}
	}
</style>
