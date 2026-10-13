<script lang="ts">
	import { Scope } from "obsidian";
	import { tick } from "svelte";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import EpisodePlayer from "./EpisodePlayer.svelte";

	let { viewRoot }: { viewRoot: HTMLElement } = $props();
	const { app, navigation } = useServices();

	let section: HTMLElement | undefined = $state();
	const id = $props.id();

	// Obsidian's keymap gives Escape to the newest scope, so a menu or modal opened
	// over the player closes first. It keeps one stack per window and pushes onto the
	// active window's, so the scope goes onto the stack of the view's window once that
	// window is active, and moves when the view moves to another window. It is pushed
	// once: pushing it again on a later focus would lift it over a modal opened since.
	// Escape typed elsewhere, as in an editor, stays there.
	$effect(() => {
		const scope = new Scope(app.scope);
		scope.register(null, "Escape", (evt) => {
			const target = evt.target as Node | null;
			if (target !== viewRoot.ownerDocument.body && !viewRoot.contains(target)) return true;
			void collapse();
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
		win.addEventListener("focus", push);
		push();
		const stopFollowing = viewRoot.onWindowMigrated((next) => {
			win.removeEventListener("focus", push);
			pop();
			win = next;
			win.addEventListener("focus", push);
			push();
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
</script>

<section class="pn-player" aria-labelledby="{id}-name" bind:this={section}>
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
	</header>
	<EpisodePlayer />
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
</style>
