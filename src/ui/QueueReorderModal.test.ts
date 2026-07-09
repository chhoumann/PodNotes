import { App } from "obsidian";
import { beforeEach, describe, expect, test } from "vitest";

import { QUEUE_SETTINGS } from "src/constants";
import { queue } from "src/store";
import type { Episode } from "src/types/Episode";
import { QueueReorderModal } from "./QueueReorderModal";

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

describe("QueueReorderModal", () => {
	beforeEach(() => {
		queue.set({
			...QUEUE_SETTINGS,
			episodes: [ep("A"), ep("B"), ep("C")],
		});
	});

	test("mounts the reorder list on open and tears it down on close", () => {
		const modal = new QueueReorderModal(new App());

		modal.open();
		expect(modal.titleEl.textContent).toBe("Reorder Queue");
		expect(modal.contentEl.querySelectorAll(".queue-reorder-item").length).toBe(3);

		modal.close();
		expect(modal.contentEl.querySelector(".queue-reorder-item")).toBeNull();
		expect(modal.contentEl.childElementCount).toBe(0);
	});
});
