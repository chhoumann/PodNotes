<script lang="ts">
	import type { Snippet } from "svelte";

	let { children }: { children: Snippet } = $props();
</script>

<div class="podcast-grid">
	{@render children()}
</div>

<style>
	.podcast-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(6rem, 1fr));
		grid-auto-rows: min-content;
		gap: 0.5rem;
	}

	@media (min-width: 400px) {
		.podcast-grid {
			grid-template-columns: repeat(auto-fill, minmax(7rem, 1fr));
			gap: 0.75rem;
		}
	}

	@media (min-width: 600px) {
		.podcast-grid {
			grid-template-columns: repeat(auto-fill, minmax(8rem, 1fr));
		}
	}
</style>
