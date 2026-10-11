// @vitest-environment jsdom
import { Menu, MenuItem } from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";

import spawnEpisodeContextMenu from "./spawnEpisodeContextMenu";
import { downloadedEpisodes, playedEpisodes, playlists, queue } from "src/store";
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
	downloadedEpisodes.set({});
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

describe("spawnEpisodeContextMenu removal item", () => {
	function downloadItemTitles(target: Episode) {
		const setTitle = vi.spyOn(MenuItem.prototype, "setTitle");
		spawnEpisodeContextMenu(target, { x: 0, y: 0 }, { ...allDisabled, download: false });
		const titles = setTitle.mock.calls.map(([title]) => title);
		setTitle.mockRestore();
		return titles;
	}

	test("offers to remove a tracked local file from Local Files", () => {
		const localFile = { ...episode, title: "Interview", podcastName: "local file" };
		downloadedEpisodes.set({
			"local file": [{ ...localFile, filePath: "Recordings/Interview.wav", size: 4 }],
		});

		expect(downloadItemTitles(localFile)).toEqual(["Remove from Local Files"]);
	});

	test("offers to remove the file of a downloaded feed episode", () => {
		downloadedEpisodes.set({
			Podcast: [{ ...episode, filePath: "Podcasts/Episode.mp3", size: 4 }],
		});

		expect(downloadItemTitles(episode)).toEqual(["Remove file"]);
	});
});
