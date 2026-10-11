import type { APIRoute } from "astro";
import { sidebarSections } from "../markdown";
import { description, site, title } from "../site.mjs";

/** The llms.txt index (https://llmstxt.org): every page, linked as raw markdown. */
export const GET: APIRoute = async () => {
	const sections = (await sidebarSections()).map(({ label, pages }) =>
		[
			`## ${label}`,
			...pages.map((page) => `- [${page.data.title}](${site}/${page.id}.md)`),
		].join("\n"),
	);
	const body = [
		`# ${title}`,
		`> ${description}`,
		`The full documentation in one file: ${site}/llms-full.txt`,
		...sections,
	].join("\n\n");
	return new Response(`${body}\n`, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};
