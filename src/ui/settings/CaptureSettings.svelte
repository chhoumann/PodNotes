<script lang="ts">
	import {
		MarkdownRenderer,
	} from "obsidian";

	import { episodeCache } from "src/store";

import type { Episode } from "src/types/Episode";
	import { onMount } from "svelte";
	import { get } from "svelte/store";
	import { NoteTemplateEngine } from "../../TemplateEngine";

	let demoEpisode: Episode;
	let markdownDemoEl: HTMLDivElement;

	onMount(() => {
		demoEpisode = getRandomEpisode();

		const temp = `## {{title}}
![]({{artwork}})
### Metadata
Podcast:: {{podcast}}
Episode:: {{title}}
PublishDate:: {{date: YYYY-MM-DD-HH-MM-SS}}

### Description
> {{description:> }}`;

		renderMarkdown(temp, markdownDemoEl);
	});

	function getRandomEpisode(): Episode {
		const fallbackDemoObj = {
			description: "demo",
			podcastName: "demo",
			title: "demo",
			url: "demo",
			artworkUrl: "demo",
			streamUrl: "demo",
			episodeDate: new Date(),
			feedUrl: "demo",
		};

		const feedEpisodes = Object.values(get(episodeCache));
		if (!feedEpisodes.length) return fallbackDemoObj;

		const randomFeed =
			feedEpisodes[Math.floor(Math.random() * feedEpisodes.length)];
		if (!randomFeed.length) return fallbackDemoObj;
		
		const randomEpisode =
			randomFeed[Math.floor(Math.random() * randomFeed.length)];

		return randomEpisode;
	}

	function renderMarkdown(markdown: string, el: HTMLElement) {
		el.empty();

		const mkdwn = NoteTemplateEngine(markdown, demoEpisode);

		MarkdownRenderer.renderMarkdown(
			mkdwn,
			el,
			"",
			// @ts-ignore
			null
		);

		// CSS selectors didn't seem to work for me, so I'm using this hacky way to get the rendered element
		// sized appropriately.
		markdownDemoEl.querySelectorAll("img").forEach((img) => {
			img.style.width = "50%";
		});
	}
</script>

<div>
	<div class="podcast-note-demo">
		<div bind:this={markdownDemoEl} />
	</div>
</div>

<style>
	.podcast-note-demo {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		width: 100%;
	}
</style>
