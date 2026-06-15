import type { Episode } from "src/types/Episode";
import type { IconType } from "src/types/IconType";
import { ViewState } from "src/types/ViewState";

export type QueueMoveKind = "top" | "up" | "down" | "bottom";

export interface QueueReorderMenuItem {
	icon: IconType;
	title: string;
	kind: QueueMoveKind;
	index: number;
}

/**
 * Builds the "move within queue" context-menu entries for an episode.
 *
 * Returns an empty list unless the menu is opened from the Player (the only
 * place the queue is shown as an ordered list), the episode is actually in the
 * queue, and there is more than one episode to reorder. End entries are omitted
 * when they would be no-ops (no "move up" on the first item, etc.).
 */
export function buildQueueReorderMenuItems(
	viewState: ViewState,
	queueEpisodes: Episode[],
	episode: Episode,
): QueueReorderMenuItem[] {
	if (viewState !== ViewState.Player) return [];

	const index = queueEpisodes.findIndex((e) => e.title === episode.title);
	if (index === -1 || queueEpisodes.length <= 1) return [];

	const items: QueueReorderMenuItem[] = [];
	const isFirst = index === 0;
	const isLast = index === queueEpisodes.length - 1;

	if (!isFirst) {
		items.push({
			icon: "chevrons-up",
			title: "Move to top of queue",
			kind: "top",
			index,
		});
		items.push({
			icon: "chevron-up",
			title: "Move up in queue",
			kind: "up",
			index,
		});
	}

	if (!isLast) {
		items.push({
			icon: "chevron-down",
			title: "Move down in queue",
			kind: "down",
			index,
		});
		items.push({
			icon: "chevrons-down",
			title: "Move to bottom of queue",
			kind: "bottom",
			index,
		});
	}

	return items;
}
