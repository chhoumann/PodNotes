import type { FeedError, FeedState } from "src/services/FeedRepository";

/**
 * Why a podcast's page and card say its feed did not load. Nothing while it loads again,
 * since a failure stays until a load succeeds. Offline, only an address missing from this
 * device, since the Offline strip says why the rest failed.
 */
export function shownFailure(feed: FeedState, online: boolean): FeedError | undefined {
	if (feed.status === "loading") return undefined;
	return online || feed.error === "unavailable" ? feed.error : undefined;
}
