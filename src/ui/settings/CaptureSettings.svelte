<script lang="ts">
	import {
		htmlToMarkdown,
		MarkdownPreviewRenderer,
		MarkdownRenderer,
	} from "obsidian";

	import { episodeCache } from "src/store";

	import { Episode } from "src/types/Episode";
	import { onMount } from "svelte";
	import { get } from "svelte/store";

	let demoEpisode: Episode;
	let markdownDemoEl: HTMLDivElement;

	onMount(() => {
		demoEpisode = getRandomEpisode();

		const temp = `## {{title}}
![]({{artworkUrl}})
### Metadata
Podcast:: {{podcastName}}
Episode:: {{title}}
PublishDate:: {{episodeDate}}

### Description
> {{description}}`;

		//renderMarkdown(temp, markdownDemoEl);
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

		const mkdwn = expandFormatSyntax(markdown, demoEpisode);

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

	function expandFormatSyntax(text: string, episode: Episode): string {
		const { title, streamUrl, description, podcastName, artworkUrl, episodeDate } =
			episode;

		return text
			.replace(/\{\{title\}\}/g, title)
			.replace(/\{\{streamUrl\}\}/g, streamUrl)
			.replace(/\{\{description\}\}/g, htmlToMarkdown(description))
			.replace(/\{\{podcastName\}\}/g, podcastName)
			.replace(/\{\{episodeDate\}\}/g, window.moment(episodeDate).format("YYYY-MM-DD"))
			.replace(/\{\{artworkUrl\}\}/g, artworkUrl || "");
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
