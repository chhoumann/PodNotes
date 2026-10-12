import { getCollection, type CollectionEntry } from "astro:content";
import { sidebar } from "./site.mjs";

type Doc = CollectionEntry<"docs">;

/** Empty `<span id>` anchors that keep old fragments working (see scripts/legacy-fragments.mjs). */
const legacyAnchor = /<span id="[^"]+"><\/span>/g;

export function pageMarkdown(entry: Doc): string {
	return `# ${entry.data.title}\n\n${(entry.body ?? "").replace(legacyAnchor, "")}`;
}

/** Docs pages grouped and ordered as in the sidebar. External links are left out. */
export async function sidebarSections(): Promise<{ label: string; pages: Doc[] }[]> {
	const unplaced = new Map((await getCollection("docs")).map((entry) => [entry.id, entry]));
	const page = (slug: string): Doc => {
		const entry = unplaced.get(slug);
		if (!entry) throw new Error(`Sidebar slug "${slug}" has no docs page, or appears twice`);
		unplaced.delete(slug);
		return entry;
	};
	const sections = sidebar.map((group) => ({
		label: group.label,
		pages: group.items.flatMap((item) => ("slug" in item ? [page(item.slug)] : [])),
	}));
	if (unplaced.size > 0) {
		throw new Error(`Docs pages missing from the sidebar: ${[...unplaced.keys()].join(", ")}`);
	}
	return sections;
}
