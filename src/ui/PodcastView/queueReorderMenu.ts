import type { QueueMove } from "src/store";
import type { Episode } from "src/types/Episode";
import { isSameEpisode } from "src/utility/episodeKey";
import type { IconType } from "src/types/IconType";

export interface QueueReorderMenuItem {
	icon: IconType;
	title: string;
	kind: QueueMove;
}

/**
 * Builds the "move within queue" context-menu entries for an episode.
 *
 * Returns an empty list unless the menu is opened from a list of the queue in
 * its order (`inQueueList`: the player's queue or the Queue page), the episode
 * is actually in the queue, and there is more than one episode to reorder. End
 * entries are omitted when they would be no-ops (no "move up" on the first item, etc.).
 */
export function buildQueueReorderMenuItems(
	inQueueList: boolean,
	queueEpisodes: Episode[],
	episode: Episode,
): QueueReorderMenuItem[] {
	if (!inQueueList) return [];

	const index = queueEpisodes.findIndex((e) => isSameEpisode(e, episode));
	if (index === -1 || queueEpisodes.length <= 1) return [];

	const items: QueueReorderMenuItem[] = [];
	const isFirst = index === 0;
	const isLast = index === queueEpisodes.length - 1;

	if (!isFirst) {
		items.push({
			icon: "chevrons-up",
			title: "Move to top of queue",
			kind: "top",
		});
		items.push({
			icon: "chevron-up",
			title: "Move up in queue",
			kind: "up",
		});
	}

	if (!isLast) {
		items.push({
			icon: "chevron-down",
			title: "Move down in queue",
			kind: "down",
		});
		items.push({
			icon: "chevrons-down",
			title: "Move to bottom of queue",
			kind: "bottom",
		});
	}

	return items;
}
