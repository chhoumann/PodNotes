// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import { description, repository, sidebar, site, title } from "./src/site.mjs";

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
					href: repository,
				},
			],
			editLink: {
				baseUrl: "https://github.com/chhoumann/PodNotes/edit/master/docs/",
			},
			customCss: ["./src/styles/custom.css"],
			head: [
				{
					tag: "link",
					attrs: {
						rel: "preload",
						href: "/fonts/InterVariable.woff2",
						as: "font",
						type: "font/woff2",
						crossorigin: "",
					},
				},
				{
					tag: "meta",
					attrs: { property: "og:image", content: `${site}/screenshots/og.png` },
				},
				{ tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
				{ tag: "meta", attrs: { property: "og:image:height", content: "630" } },
				{ tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
			],
			sidebar,
			components: {
				MarkdownContent: "./src/components/MarkdownContent.astro",
				PageTitle: "./src/components/PageTitle.astro",
			},
		}),
	],
});
