import type { FeedKey, FeedState } from "src/services/FeedRepository";
import type { IconType } from "src/types/IconType";
import type { Playlist } from "src/types/Playlist";
import type { PlayedEpisodeMap } from "src/utility/episodeStatus";
import { ownRecord } from "src/utility/ownRecord";
import { formatMinutes, secondsLeft } from "./episodeRow";
import type { Layout } from "./layout";

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
/** The pages that list episodes with no filter bar, in the order their list keeps. */
export type ListPage = Extract<Page, { kind: "latest" | "played" | "playlist" | "local" }>;

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

/** What the shell's head, and the top of its page, show for a page. */
export interface Head {
	/** The Back button, named by the page it returns to. */
	readonly back?: string;
	readonly title?: string;
	/** The title at the top of the page's scroller. */
	readonly pageTitle?: string;
	/** Beside whichever title the head has: the queue's time left, a playlist's count. */
	readonly flair?: string;
	/**
	 * The head's right edge: the compact Library's Add podcast and Settings, Refresh
	 * all on the wide Library and Latest, a podcast's menu, or the queue's.
	 */
	readonly action?: "library" | "refresh-all" | "podcast" | "queue";
	/** Add podcast's search field stands in the title's place. */
	readonly search?: true;
}

/** The lists a head's flair counts. */
export interface HeadLists {
	readonly queue: Playlist;
	readonly favorites: Playlist;
	readonly playlists: Readonly<Record<string, Playlist>>;
	readonly played: PlayedEpisodeMap;
}

function actionOf({ kind }: Page, layout: Layout): Head["action"] {
	if (kind === "library") return layout === "wide" ? "refresh-all" : "library";
	if (kind === "latest") return "refresh-all";
	if (kind === "feed") return "podcast";
	if (kind === "queue") return "queue";
	return undefined;
}

function flairOf(page: Page, { queue, favorites, playlists, played }: HeadLists) {
	if (page.kind === "queue") {
		const left = secondsLeft(queue.episodes, played);
		return left > 0 ? formatMinutes(left) : undefined;
	}
	if (page.kind !== "playlist") return undefined;
	const list = page.name === favorites.name ? favorites : ownRecord(playlists)[page.name];
	return list && String(list.episodes.length);
}

/**
 * The wide rail reaches and names every root, so a root there has no Back and
 * its head takes the rail's name. Add podcast keeps a Back to a page that led to
 * it, such as First run. A podcast's page is headed by its artwork and title
 * inside the list. `previous` is the page the user came from, if any.
 */
export function headFor(
	page: Page,
	layout: Layout,
	previous: Page | undefined,
	feeds: ReadonlyMap<FeedKey, FeedState>,
	lists: HeadLists,
): Head {
	const { kind } = page;
	const search = kind === "add" || undefined;
	const action = actionOf(page, layout);
	const flair = flairOf(page, lists);
	if (layout === "wide" && isRoot(page)) {
		if (search) return previous ? { back: pageLabel(previous, feeds), search } : { search };
		return { title: rootItem(page.kind).label, flair, action };
	}
	const back = previous ?? parentOf(page);
	const label = pageLabel(page, feeds);
	return {
		back: back ? pageLabel(back, feeds) : undefined,
		title: kind === "library" ? label : undefined,
		pageTitle: kind === "library" || kind === "feed" || search ? undefined : label,
		flair,
		action,
		search,
	};
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
