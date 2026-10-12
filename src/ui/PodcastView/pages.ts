import type { FeedKey, FeedState } from "src/services/FeedRepository";
import type { IconType } from "src/types/IconType";

/** A page the shell shows. Plain JSON, so it is also the view's workspace state. */
export type Page =
	| { kind: "library" }
	| { kind: "latest" }
	| { kind: "queue" }
	| { kind: "playlists" }
	| { kind: "local" }
	| { kind: "played" }
	| { kind: "add" }
	| { kind: "feed"; key: FeedKey }
	| { kind: "playlist"; name: string };

export type RootKind = Exclude<Page["kind"], "feed" | "playlist">;
export type RootPage = Extract<Page, { kind: RootKind }>;
/** The pages that list episodes. */
export type ListPage = Extract<
	Page,
	{ kind: "latest" | "queue" | "local" | "played" | "feed" | "playlist" }
>;

export interface RootItem {
	readonly kind: RootKind;
	readonly icon: IconType;
	readonly label: string;
}

/** The rail, top to bottom. The rail shows `add` as its search button. */
export const ROOTS: readonly RootItem[] = [
	{ kind: "add", icon: "search", label: "Add podcast" },
	{ kind: "library", icon: "layout-grid", label: "Podcasts" },
	{ kind: "latest", icon: "inbox", label: "Latest episodes" },
	{ kind: "queue", icon: "list-end", label: "Queue" },
	{ kind: "playlists", icon: "list-music", label: "Playlists" },
	{ kind: "local", icon: "folder", label: "Local files" },
	{ kind: "played", icon: "history", label: "Played" },
];

/** The roots that list episodes or playlists: the compact Library's rows. */
export const LIST_ROOTS = ROOTS.filter(({ kind }) => kind !== "add" && kind !== "library");

/** The counts the rail and the Library rows show beside a root. */
export type RootCounts = Readonly<Partial<Record<RootKind, number>>>;

export function isRoot(page: Page): page is RootPage {
	return page.kind !== "feed" && page.kind !== "playlist";
}

/** The rail item a page lights: a podcast lights Podcasts, a playlist lights Playlists. */
export function activeRoot(page: Page): RootKind {
	if (page.kind === "feed") return "library";
	if (page.kind === "playlist") return "playlists";
	return page.kind;
}

/** Where Back goes when nothing was visited before a page. Library is the top of the stack. */
export function parentOf(page: Page): Page | undefined {
	if (page.kind === "library") return undefined;
	if (page.kind === "playlist") return { kind: "playlists" };
	return { kind: "library" };
}

export function rootItem(kind: RootKind): RootItem {
	return ROOTS.find((item) => item.kind === kind)!;
}

/** A page's title, and its name on a Back button. The rail calls Library "Podcasts". */
export function pageLabel(page: Page, feeds: ReadonlyMap<FeedKey, FeedState>): string {
	if (page.kind === "feed") return feeds.get(page.key)?.feed.title ?? page.key;
	if (page.kind === "playlist") return page.name;
	if (page.kind === "library") return "Library";
	return rootItem(page.kind).label;
}

/** The same page always gives the same key, so `{#key}` remounts on a page change only. */
export function pageKey(page: Page): string {
	if (page.kind === "feed") return `feed:${page.key}`;
	if (page.kind === "playlist") return `playlist:${page.name}`;
	return page.kind;
}

/** Workspace state comes from disk: anything that is not exactly a page is rejected. */
export function parsePage(value: unknown): Page | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const { kind, key, name } = value as Record<string, unknown>;
	if (kind === "feed") return typeof key === "string" ? { kind, key } : undefined;
	if (kind === "playlist") return typeof name === "string" ? { kind, name } : undefined;
	const root = ROOTS.find((item) => item.kind === kind);
	return root ? { kind: root.kind } : undefined;
}

/** Whether a page still has something to show: its podcast or playlist was not removed. */
export function pageExists(
	page: Page,
	feeds: ReadonlyMap<FeedKey, FeedState>,
	playlistNames: ReadonlySet<string>,
): boolean {
	if (page.kind === "feed") return feeds.has(page.key);
	if (page.kind === "playlist") return playlistNames.has(page.name);
	return true;
}

export function samePage(a: Page, b: Page): boolean {
	return pageKey(a) === pageKey(b);
}
