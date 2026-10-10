import type { APIRoute, GetStaticPaths, InferGetStaticPropsType } from "astro";
import { getCollection } from "astro:content";
import { pageMarkdown } from "../markdown";

/**
 * Raw markdown for every docs page at `<page-url>.md` (e.g. /commands.md,
 * and /index.md for the home page) - for LLMs and coding agents.
 */
export const getStaticPaths = (async () => {
	const docs = await getCollection("docs");
	return docs.map((entry) => ({
		params: { slug: entry.id },
		props: { entry },
	}));
}) satisfies GetStaticPaths;

export const GET: APIRoute<InferGetStaticPropsType<typeof getStaticPaths>> = ({ props }) =>
	new Response(pageMarkdown(props.entry), {
		headers: { "Content-Type": "text/markdown; charset=utf-8" },
	});
