// Shared by astro.config.mjs and the llms.txt endpoints, so the sidebar and
// the LLM indexes list the same pages in the same order.
import manifest from "../../manifest.json" with { type: "json" };

export const title = "PodNotes";

export const site = "https://podnotes.obsidian.guide";

export const { description } = manifest;

export const repository = "https://github.com/chhoumann/PodNotes";

export const sidebar = [
	{
		label: "Start here",
		items: [
			{ label: "Overview", slug: "index" },
			{ label: "Getting started", slug: "getting-started" },
			{ label: "Use PodNotes on your phone", slug: "mobile" },
		],
	},
	{
		label: "Listen",
		items: [
			{ label: "Add and play podcasts", slug: "podcasts" },
			{ label: "Use the player", slug: "player" },
			{ label: "Use private feeds", slug: "private-feeds" },
			{ label: "Use the queue and playlists", slug: "playlists" },
			{ label: "Downloads and local files", slug: "local_files" },
			{ label: "Transcribe episodes", slug: "transcripts" },
		],
	},
	{
		label: "Take notes",
		items: [
			{ label: "Capture timestamps", slug: "timestamps" },
			{ label: "Create episode notes", slug: "notes" },
		],
	},
	{
		label: "Your library",
		items: [
			{ label: "Sync between devices", slug: "sync" },
			{ label: "Fix save problems", slug: "save-problems" },
			{ label: "Import and export", slug: "import_export" },
		],
	},
	{
		label: "Automate",
		items: [
			{ label: "Use with QuickAdd", slug: "QuickAdd" },
			{ label: "API", slug: "api" },
		],
	},
	{
		label: "Reference",
		items: [
			{ label: "Commands", slug: "commands" },
			{ label: "Settings", slug: "settings" },
			{ label: "Template tags", slug: "templates" },
		],
	},
	{
		label: "Help",
		items: [
			{ label: "FAQ", slug: "faq" },
			{ label: "Report a problem", link: `${repository}/issues` },
			{ label: "Release notes", link: `${repository}/releases` },
		],
	},
];
