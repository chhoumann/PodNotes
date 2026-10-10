// Shared by astro.config.mjs and the llms.txt endpoints, so the sidebar and
// the LLM indexes list the same pages in the same order.
import manifest from "../../manifest.json" with { type: "json" };

export const site = "https://podnotes.obsidian.guide";

export const { description } = manifest;

export const sidebar = [
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
];
