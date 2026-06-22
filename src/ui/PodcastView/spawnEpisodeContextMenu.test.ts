import { Menu } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";

import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
import { playedEpisodes, playlists, queue } from "src/store";
import type { Episode } from "src/types/Episode";

const episode: Episode = {
	title: "Episode",
	streamUrl: "https://example.com/a.mp3",
	url: "https://example.com/a",
	description: "",
	content: "",
	podcastName: "Podcast",
} as Episode;

// Disable every menu section so the menu has no store/plugin dependencies and we
// can assert purely on how it is anchored.
const allDisabled = {
	play: true,
	markPlayed: true,
	download: true,
	createNote: true,
	favorite: true,
	queue: true,
	playlists: true,
};

beforeEach(() => {
	queue.set({
		icon: "list-ordered",
		name: "Queue",
		episodes: [],
		shouldEpisodeRemoveAfterPlay: true,
		shouldRepeat: false,
	});
	playlists.set({});
	playedEpisodes.set({});
});

describe("spawnEpisodeContextMenu anchoring (CM-general)", () => {
	test("opens at the mouse position for a MouseEvent anchor (right-click)", () => {
		const atMouse = vi.spyOn(Menu.prototype, "showAtMouseEvent");
		const atPos = vi.spyOn(Menu.prototype, "showAtPosition");

		spawnEpisodeContextMenu(episode, new MouseEvent("contextmenu"), allDisabled);

		expect(atMouse).toHaveBeenCalledTimes(1);
		expect(atPos).not.toHaveBeenCalled();

		atMouse.mockRestore();
		atPos.mockRestore();
	});

	test("opens at an explicit {x,y} for the keyboard/mobile kebab affordance", () => {
		const atMouse = vi.spyOn(Menu.prototype, "showAtMouseEvent");
		const atPos = vi.spyOn(Menu.prototype, "showAtPosition");

		spawnEpisodeContextMenu(episode, { x: 12, y: 34 }, allDisabled);

		expect(atPos).toHaveBeenCalledWith({ x: 12, y: 34 });
		expect(atMouse).not.toHaveBeenCalled();

		atMouse.mockRestore();
		atPos.mockRestore();
	});
});
