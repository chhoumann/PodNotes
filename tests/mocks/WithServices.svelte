<script lang="ts">
	import type { Component } from "svelte";
	import { provideServices, type ShellServices } from "src/ui/PodcastView/context";

	/** Renders a view component on its own, inside the services the shell would provide. */
	let {
		services,
		component: Child,
		props = {},
	}: {
		services: ShellServices;
		component: Component<any>;
		props?: Record<string, unknown>;
	} = $props();
	// svelte-ignore state_referenced_locally
	provideServices(services);
</script>

<Child {...props} />
