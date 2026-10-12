<script lang="ts">
	import { Scope } from "obsidian";
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import EpisodePlayer from "./EpisodePlayer.svelte";

	let { viewRoot }: { viewRoot: HTMLElement } = $props();
	const { app, navigation } = useServices();

	// Obsidian's keymap gives Escape to the newest scope, so a menu or modal opened
	// over the player closes first. Escape typed elsewhere, as in an editor, stays there.
	$effect(() => {
		const scope = new Scope(app.scope);
		scope.register(null, "Escape", () => {
			if (!viewRoot.contains(viewRoot.ownerDocument.activeElement)) return true;
			navigation.collapse();
			return false;
		});
		app.keymap.pushScope(scope);
		return () => app.keymap.popScope(scope);
	});

	/** Takes focus unless the player opened while the user works elsewhere, as when a link plays. */
	function focusFromView(button: HTMLButtonElement) {
		const active = button.ownerDocument.activeElement;
		if (!active || active === button.ownerDocument.body || viewRoot.contains(active)) {
			button.focus();
		}
	}
</script>

<section class="pn-player" aria-label="Player">
	<header class="pn-np-head">
		<button
			type="button"
			class="pn-iconbtn"
			aria-label="Collapse player"
			title="Collapse player"
			onclick={() => navigation.collapse()}
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
