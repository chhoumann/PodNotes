import { type App, FuzzySuggestModal } from "obsidian";
import type { PodcastFeed } from "src/types/PodcastFeed";

/**
 * Order feeds so the currently-playing podcast's feed (if any) sorts first, so
 * the picker opens on the most likely choice. Pure, for testability.
 */
export function orderFeedsByCurrent(
	feeds: PodcastFeed[],
	currentPodcastName?: string,
): PodcastFeed[] {
	if (!currentPodcastName) return feeds;

	return [
		...feeds.filter((feed) => feed.title === currentPodcastName),
		...feeds.filter((feed) => feed.title !== currentPodcastName),
	];
}

/**
 * Fuzzy picker over the user's saved podcast feeds, used by the "Create podcast
 * feed note" command so a feed note can be created without playing an episode
 * (issue #161).
 */
export class FeedSuggestModal extends FuzzySuggestModal<PodcastFeed> {
	private feeds: PodcastFeed[];
	private onChoose: (feed: PodcastFeed) => void;

	constructor(
		app: App,
		feeds: PodcastFeed[],
		onChoose: (feed: PodcastFeed) => void,
	) {
		super(app);
		this.feeds = feeds;
		this.onChoose = onChoose;
		this.setPlaceholder("Select a podcast to create or open its note");
	}

	getItems(): PodcastFeed[] {
		return this.feeds;
	}

	getItemText(feed: PodcastFeed): string {
		return feed.title;
	}

	onChooseItem(feed: PodcastFeed): void {
		this.onChoose(feed);
	}
}
