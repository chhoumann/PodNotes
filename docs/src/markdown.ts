import { getCollection, type CollectionEntry } from "astro:content";
import { sidebar } from "./site.mjs";

type Doc = CollectionEntry<"docs">;

/** Empty `<span id>` anchors that keep old MkDocs fragments working (see scripts/legacy-fragments.mjs). */
const legacyAnchor = /<span id="[^"]+"><\/span>/g;

export function pageMarkdown(entry: Doc): string {
	return `# ${entry.data.title}\n\n${(entry.body ?? "").replace(legacyAnchor, "")}`;
}

/** Docs pages grouped and ordered as in the sidebar. Ungrouped pages come first, under "Docs". */
export async function sidebarSections(): Promise<{ label: string; pages: Doc[] }[]> {
	const unplaced = new Map((await getCollection("docs")).map((entry) => [entry.id, entry]));
	const page = (slug: string): Doc => {
		const entry = unplaced.get(slug);
		if (!entry) throw new Error(`Sidebar slug "${slug}" has no docs page, or appears twice`);
		unplaced.delete(slug);
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
	if (unplaced.size > 0) {
		throw new Error(`Docs pages missing from the sidebar: ${[...unplaced.keys()].join(", ")}`);
	}
	return sections;
}
