// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import { description, sidebar, site, title } from "./src/site.mjs";

// https://astro.build/config
export default defineConfig({
	site,
	integrations: [
		starlight({
			title,
			description,
			plugins: [starlightLinksValidator()],
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
						content: `${site}/resources/podcast_grid.png`,
					},
				},
			],
			sidebar,
			components: { PageTitle: "./src/components/PageTitle.astro" },
		}),
	],
});
