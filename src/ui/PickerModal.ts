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

export class PickerModal<T> extends FuzzySuggestModal<T> {
	constructor(
		app: App,
		private readonly items: readonly T[],
		private readonly getText: (item: T) => string,
		placeholder: string,
		private readonly onChoose: (item: T) => void,
	) {
		super(app);
		this.setPlaceholder(placeholder);
	}

	getItems(): T[] {
		return [...this.items];
	}

	getItemText(item: T): string {
		return this.getText(item);
	}

	onChooseItem(item: T): void {
		this.onChoose(item);
	}
}
