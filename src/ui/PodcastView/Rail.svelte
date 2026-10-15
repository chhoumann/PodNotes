<script lang="ts">
	import { icon } from "../obsidian/icon";
	import { useServices } from "./context";
	import { ROOTS, rootItem, type RootCounts, type RootKind } from "./pages";

	let { counts, active }: { counts: RootCounts; active: RootKind } = $props();
	const { navigation, openSettings } = useServices();
	const add = rootItem("add");
	const id = $props.id();
</script>

<nav class="pn-rail" aria-labelledby="{id}-name">
	<span id="{id}-name" hidden>PodNotes</span>
	<button type="button" class="pn-railsearch" onclick={() => navigation.goRoot("add")}>
		<span class="pn-railsearch-icon" {@attach icon(add.icon)}></span>
		<span>{add.label}</span>
	</button>
	<div class="pn-nav">
		{#each ROOTS.filter(({ kind }) => kind !== "add") as root (root.kind)}
			<button
				type="button"
				class="pn-navitem"
				class:is-active={active === root.kind}
				aria-current={active === root.kind ? "page" : undefined}
				onclick={() => navigation.goRoot(root.kind)}
			>
				<span class="pn-navicon" {@attach icon(root.icon)}></span>
				<span class="lbl">{root.label}</span>
				{#if counts[root.kind]}<span class="flair">{counts[root.kind]}</span>{/if}
			</button>
		{/each}
	</div>
	<span class="pn-spacer"></span>
	<div class="pn-nav">
		<button type="button" class="pn-navitem" onclick={openSettings}>
			<span class="pn-navicon" {@attach icon("settings")}></span>
			<span class="lbl">Settings</span>
		</button>
	</div>
</nav>

<style>
	.pn-rail {
		display: flex;
		flex-direction: column;
		gap: var(--size-4-3);
		min-height: 0;
		overflow-y: auto;
		padding: var(--size-4-3) var(--size-4-2);
		background: var(--background-secondary);
		border-right: 1px solid var(--background-modifier-border);
	}

	.pn-railsearch {
		display: flex;
		justify-content: flex-start;
		gap: var(--size-4-2);
		flex: none;
		width: 100%;
		padding: 0 var(--size-4-2);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--input-radius);
		background: var(--background-modifier-form-field);
		box-shadow: none;
		color: var(--text-muted);
		text-align: left;
	}

	@media (hover: hover) {
		.pn-railsearch:hover {
			border-color: var(--background-modifier-border-hover);
			color: var(--text-normal);
		}
	}

	.pn-railsearch-icon {
		display: flex;
		--icon-size: var(--icon-xs);
		--icon-stroke: var(--icon-xs-stroke-width);
	}
</style>
