// @ts-check
import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import starlightLinksValidator from "starlight-links-validator";
import starlightLlmsTxt from "starlight-llms-txt";

const { description } = JSON.parse(
	readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
);

/**
 * Every docs page must pin its URL with `slug:` frontmatter - without it,
 * Astro lowercases the generated slug and the page's historical MixedCase
 * URL silently changes. Fail the build instead.
 * @returns {import("astro").AstroIntegration}
 */
function enforceExplicitSlugs() {
	return {
		name: "podnotes:enforce-explicit-slugs",
		hooks: {
			"astro:config:setup": () => {
				const root = fileURLToPath(new URL("./src/content/docs/", import.meta.url));
				const missing = globSync("**/*.md", { cwd: root }).filter(
					(file) =>
						!/^slug:/m.test(
							readFileSync(root + file, "utf8").split("\n---\n", 2)[0] ?? "",
						),
				);
				if (missing.length > 0) {
					throw new Error(
						`Docs pages missing explicit "slug:" frontmatter (URLs would silently change): ${missing.join(", ")}`,
					);
				}
			},
		},
	};
}

// https://astro.build/config
export default defineConfig({
	site: "https://podnotes.obsidian.guide",
	integrations: [
		enforceExplicitSlugs(),
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
				{
					tag: "meta",
					attrs: { name: "twitter:card", content: "summary_large_image" },
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
