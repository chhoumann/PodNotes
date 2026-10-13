import { describe, expect, test } from "vitest";

import type { Episode } from "src/types/Episode";
import { buildQueueReorderMenuItems } from "./queueReorderMenu";

function ep(title: string): Episode {
	return {
		title,
		streamUrl: `https://example.com/${title}.mp3`,
		url: `https://example.com/${title}`,
		description: "",
		content: "",
		podcastName: "Pod",
	};
}

const queueEpisodes = [ep("A"), ep("B"), ep("C")];
const titles = (items: { title: string }[]) => items.map((i) => i.title);

describe("buildQueueReorderMenuItems", () => {
	test("returns nothing outside a list of the queue", () => {
		expect(buildQueueReorderMenuItems(false, queueEpisodes, ep("B"))).toEqual([]);
	});

	test("returns nothing when the episode is not queued", () => {
		expect(buildQueueReorderMenuItems(true, queueEpisodes, ep("Z"))).toEqual([]);
	});

	test("returns nothing for a single-item queue", () => {
		expect(buildQueueReorderMenuItems(true, [ep("A")], ep("A"))).toEqual([]);
	});

	test("a middle item offers all four moves", () => {
		const items = buildQueueReorderMenuItems(true, queueEpisodes, ep("B"));

		expect(titles(items)).toEqual([
			"Move to top of queue",
			"Move up in queue",
			"Move down in queue",
			"Move to bottom of queue",
		]);
		expect(items.map((i) => i.kind)).toEqual(["top", "up", "down", "bottom"]);
	});

	test("the first item omits the upward moves", () => {
		const items = buildQueueReorderMenuItems(true, queueEpisodes, ep("A"));

		expect(items.map((i) => i.kind)).toEqual(["down", "bottom"]);
	});

	test("the last item omits the downward moves", () => {
		const items = buildQueueReorderMenuItems(true, queueEpisodes, ep("C"));

		expect(items.map((i) => i.kind)).toEqual(["top", "up"]);
	});
});
