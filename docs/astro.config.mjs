// @ts-check
import { readFileSync } from "node:fs";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";

const { description } = JSON.parse(
	readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);

// https://astro.build/config
export default defineConfig({
	site: "https://podnotes.obsidian.guide",
	integrations: [
		starlight({
			title: "PodNotes",
			description,
			plugins: [
				starlightLinksValidator(),
				starlightLlmsTxt({ projectName: "PodNotes", description }),
			],
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/chhoumann/PodNotes",
				},
			],
			editLink: {
				baseUrl: "https://github.com/chhoumann/PodNotes/edit/master/docs/",
			},
			head: [
				{
					tag: "meta",
					attrs: {
						property: "og:image",
						content: "https://podnotes.obsidian.guide/resources/podcast_grid.png",
					},
				},
			],
			sidebar: [
				{ label: "Home", slug: "index" },
				{ label: "Commands", slug: "commands" },
				{ label: "Podcasts", slug: "podcasts" },
				{ label: "Local files", slug: "local_files" },
				{ label: "Import & Export", slug: "import_export" },
				{ label: "Transcripts", slug: "transcripts" },
				{
					label: "Notes",
					items: [
						{ label: "Timestamps", slug: "timestamps" },
						{ label: "Templates", slug: "templates" },
					],
				},
				{
					label: "Advanced",
					items: [
						{ label: "API", slug: "api" },
						{ label: "Usage with QuickAdd", slug: "QuickAdd" },
					],
				},
			],
		}),
	],
});
