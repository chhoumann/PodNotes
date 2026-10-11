import type { APIRoute } from "astro";
import { pageMarkdown, sidebarSections } from "../markdown";

/** Every docs page as markdown, in sidebar order, in one file. */
export const GET: APIRoute = async () => {
	const pages = (await sidebarSections()).flatMap((section) => section.pages);
	return new Response(`${pages.map(pageMarkdown).join("\n\n")}\n`, {
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
};
