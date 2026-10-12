export type Layout = "compact" | "wide";

/** Below this view width the shell is compact (a page stack); from it on, wide (a rail). */
export const COMPACT_MAX_WIDTH = 560;

export function layoutFor(width: number): Layout {
	return width < COMPACT_MAX_WIDTH ? "compact" : "wide";
}
