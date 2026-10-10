import { getCollection, type CollectionEntry } from "astro:content";
import { sidebar } from "./site.mjs";

type Doc = CollectionEntry<"docs">;

export function pageMarkdown(entry: Doc): string {
	return `# ${entry.data.title}\n\n${entry.body ?? ""}`;
}

/** Docs pages grouped and ordered as in the sidebar. Ungrouped pages come first, under "Docs". */
export async function sidebarSections(): Promise<{ label: string; pages: Doc[] }[]> {
	const docs = new Map((await getCollection("docs")).map((entry) => [entry.id, entry]));
	const page = (slug: string): Doc => {
		const entry = docs.get(slug);
		if (!entry) throw new Error(`Sidebar slug "${slug}" has no docs page`);
		return entry;
	};
	const ungrouped = { label: "Docs", pages: [] as Doc[] };
	const sections = [ungrouped];
	for (const item of sidebar) {
		if (item.items) {
			sections.push({
				label: item.label,
				pages: item.items.map((child) => page(child.slug)),
			});
		} else {
			ungrouped.pages.push(page(item.slug));
		}
	}
	return sections;
}
