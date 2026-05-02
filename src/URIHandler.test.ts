import { get } from "svelte/store";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from "vitest";

import podNotesURIHandler from "./URIHandler";
import {
	currentEpisode,
	currentTime,
	isPaused,
	playedEpisodes,
	requestedPlaybackTime,
	viewState,
} from "./store";
import type { Episode } from "./types/Episode";
import { ViewState } from "./types/ViewState";

const mockFindItemByTitle = vi.fn();
const testFeedUrl = "https://pod.example.com/feed.xml";

vi.mock("./parser/feedParser", () => ({
	default: class {
		findItemByTitle = mockFindItemByTitle;
	},
}));

const testEpisode: Episode = {
	title: "Finished Episode",
	streamUrl: "https://pod.example.com/audio.mp3",
	url: "https://pod.example.com/episode",
	description: "",
	content: "",
	podcastName: "Test Podcast",
	feedUrl: testFeedUrl,
};

function resetStores() {
	currentEpisode.update(() => undefined as unknown as Episode);
	currentTime.set(0);
	isPaused.set(true);
	playedEpisodes.set({});
	requestedPlaybackTime.set(null);
	viewState.set(ViewState.PodcastGrid);
}

const api = {
	set currentTime(value: number) {
		currentTime.set(value);
	},
};

beforeEach(() => {
	resetStores();
	mockFindItemByTitle.mockResolvedValue(testEpisode);

	(globalThis as { app?: unknown }).app = {
		vault: {
			getAbstractFileByPath: vi.fn(() => null),
		},
	};
});

afterEach(() => {
	resetStores();
	mockFindItemByTitle.mockReset();
	delete (globalThis as { app?: unknown }).app;
});

describe("podNotesURIHandler", () => {
	test("seeks and resumes when the linked episode is already visible", async () => {
		currentEpisode.set(testEpisode);
		viewState.set(ViewState.Player);
		currentTime.set(3600);
		isPaused.set(true);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "120",
			},
			api as never,
		);

		expect(get(viewState)).toBe(ViewState.Player);
		expect(get(currentTime)).toBe(120);
		expect(get(isPaused)).toBe(false);
		expect(get(requestedPlaybackTime)).toBeNull();
		expect(mockFindItemByTitle).not.toHaveBeenCalled();
	});

	test("keeps the requested time for the player to apply after loading metadata", async () => {
		playedEpisodes.markAsPlayed(testEpisode);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "240",
			},
			api as never,
		);

		expect(mockFindItemByTitle).toHaveBeenCalledWith(
			testEpisode.title,
			testFeedUrl,
		);
		expect(get(currentEpisode)).toMatchObject({
			title: testEpisode.title,
		});
		expect(get(viewState)).toBe(ViewState.Player);
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 240,
		});
		expect(get(playedEpisodes)[`${testEpisode.podcastName}::${testEpisode.title}`]?.finished).toBe(
			true,
		);
	});
});
