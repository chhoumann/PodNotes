import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import podNotesURIHandler from "./URIHandler";
import {
	currentEpisode,
	currentTime,
	duration,
	isPaused,
	activePlaybackSegment,
	localFiles,
	playedEpisodes,
	plugin,
	requestedPlaybackTime,
	viewState,
} from "./store";
import type { Episode } from "./types/Episode";
import type { LocalEpisode } from "./types/LocalEpisode";
import type { Playlist } from "./types/Playlist";
import { ViewState } from "./types/ViewState";

const mockGetEpisodes = vi.fn();
const testFeedUrl = "https://pod.example.com/feed.xml";

vi.mock("./parser/feedParser", () => ({
	default: class {
		getEpisodes = mockGetEpisodes;
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

// Title with a literal '+': current-format links carry it as a real '+' after Obsidian's decode.
const plusEpisode: Episode = {
	title: "Episode 50: C++ Tips",
	streamUrl: "https://pod.example.com/cpp.mp3",
	url: "https://pod.example.com/cpp",
	description: "",
	content: "",
	podcastName: "Test Podcast",
	feedUrl: testFeedUrl,
};

const emptyLocalFiles: Playlist = {
	icon: "folder",
	name: "Local Files",
	episodes: [],
	shouldEpisodeRemoveAfterPlay: false,
	shouldRepeat: false,
};

function resetStores() {
	currentEpisode.update(() => undefined as unknown as Episode);
	currentTime.set(0);
	duration.set(0);
	isPaused.set(true);
	activePlaybackSegment.set(null);
	playedEpisodes.set({});
	requestedPlaybackTime.set(null);
	viewState.set(ViewState.PodcastGrid);
	localFiles.set({ ...emptyLocalFiles, episodes: [] });
}

const api = {
	set currentTime(value: number) {
		currentTime.set(value);
	},
};

function setApp(getAbstractFileByPath: (path: string) => unknown) {
	plugin.set({
		app: { vault: { getAbstractFileByPath: vi.fn(getAbstractFileByPath) } },
	} as never);
}

beforeEach(() => {
	resetStores();
	mockGetEpisodes.mockResolvedValue([testEpisode]);
	setApp(() => null);
});

afterEach(() => {
	resetStores();
	mockGetEpisodes.mockReset();
	plugin.set(undefined as never);
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
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("keeps the requested time for the player to apply after loading metadata", async () => {
		playedEpisodes.markAsPlayed(testEpisode);
		const revealPlayer = vi.fn();

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "240",
			},
			api as never,
			revealPlayer,
		);

		expect(mockGetEpisodes).toHaveBeenCalledWith(testFeedUrl);
		expect(get(currentEpisode)).toMatchObject({ title: testEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 240,
		});
		expect(get(activePlaybackSegment)).toBeNull();
		expect(
			get(playedEpisodes)[`${testEpisode.podcastName}::${testEpisode.title}`]?.finished,
		).toBe(true);
		expect(revealPlayer).toHaveBeenCalledTimes(1);
	});

	test("does not reveal the player when URI validation fails", async () => {
		const revealPlayer = vi.fn();

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "not-a-number",
			},
			api as never,
			revealPlayer,
		);

		expect(revealPlayer).not.toHaveBeenCalled();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
	});

	test.each([
		"http://169.254.169.254/latest/meta-data/",
		"http://127.0.0.1:8080/feed.xml",
		"http://192.168.0.1/feed.xml",
	])(
		"refuses a deep link whose url points at an internal host (%s) without fetching",
		async (url) => {
			const revealPlayer = vi.fn();

			await podNotesURIHandler(
				{
					action: "podnotes",
					url,
					episodeName: "Some Episode",
				},
				api as never,
				revealPlayer,
			);

			// The attacker-controlled url is never handed to the feed parser.
			expect(mockGetEpisodes).not.toHaveBeenCalled();
			expect(get(currentEpisode)).toBeUndefined();
			expect(get(viewState)).toBe(ViewState.PodcastGrid);
			expect(revealPlayer).not.toHaveBeenCalled();
		},
	);

	test("keeps the requested segment end for the player to apply after loading metadata", async () => {
		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "240",
				endTime: "260",
			},
			api as never,
		);

		expect(mockGetEpisodes).toHaveBeenCalledWith(testFeedUrl);
		expect(get(currentEpisode)).toMatchObject({ title: testEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 240,
			endTime: 260,
		});
		expect(get(activePlaybackSegment)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			startTime: 240,
			endTime: 260,
		});
	});

	test("seeks and arms a segment when the linked episode is already visible", async () => {
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
				endTime: "135",
			},
			api as never,
		);

		expect(get(currentTime)).toBe(120);
		expect(get(isPaused)).toBe(false);
		expect(get(activePlaybackSegment)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			startTime: 120,
			endTime: 135,
		});
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("normal timestamp links clear a stale active segment", async () => {
		currentEpisode.set(testEpisode);
		activePlaybackSegment.set({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			startTime: 10,
			endTime: 20,
		});

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "120",
			},
			api as never,
		);

		expect(get(activePlaybackSegment)).toBeNull();
	});

	test("switches to a non-loaded episode whose title contains a literal '+'", async () => {
		mockGetEpisodes.mockResolvedValue([plusEpisode]);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				// Current-format link: Obsidian decodes %2B back to a literal '+'.
				episodeName: "Episode 50: C++ Tips",
				time: "300",
			},
			api as never,
		);

		expect(get(currentEpisode)).toMatchObject({ title: "Episode 50: C++ Tips" });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${plusEpisode.podcastName}::${plusEpisode.title}`,
			time: 300,
		});
	});

	test("resumes a paused, already-loaded episode whose title contains a literal '+'", async () => {
		currentEpisode.set(plusEpisode);
		viewState.set(ViewState.Player);
		isPaused.set(true);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: "Episode 50: C++ Tips",
				time: "90",
			},
			api as never,
		);

		expect(get(currentTime)).toBe(90);
		expect(get(isPaused)).toBe(false);
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("resolves a legacy '+'-as-space link to a non-loaded episode", async () => {
		mockGetEpisodes.mockResolvedValue([testEpisode]);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				// Legacy link: spaces were encoded as '+'.
				episodeName: "Finished+Episode",
				time: "60",
			},
			api as never,
		);

		expect(get(currentEpisode)).toMatchObject({ title: "Finished Episode" });
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 60,
		});
	});

	test("resumes the loaded episode for a legacy '+'-as-space link without re-resolving", async () => {
		currentEpisode.set(testEpisode);
		viewState.set(ViewState.Player);
		isPaused.set(true);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: "Finished+Episode",
				time: "45",
			},
			api as never,
		);

		expect(get(currentTime)).toBe(45);
		expect(get(isPaused)).toBe(false);
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("resolves a local-file episode whose path and title both contain '+'", async () => {
		const localEpisode: LocalEpisode = {
			title: "C++ Tips",
			streamUrl: "Notes+/C++ Tips.mp3",
			url: "Notes+/C++ Tips.mp3",
			description: "",
			content: "",
			podcastName: "local file",
			filePath: "Notes+/C++ Tips.mp3",
		};
		localFiles.set({ ...emptyLocalFiles, episodes: [localEpisode] });
		// Only the raw (current-format) path resolves to a file.
		setApp((path) => (path === "Notes+/C++ Tips.mp3" ? {} : null));

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: "Notes+/C++ Tips.mp3",
				episodeName: "C++ Tips",
				time: "30",
			},
			api as never,
		);

		expect(get(currentEpisode)).toMatchObject({ title: "C++ Tips" });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: "local file::C++ Tips",
			time: 30,
		});
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("resolves a moved/renamed local file by name instead of routing to the feed parser (LF-08)", async () => {
		const localEpisode: LocalEpisode = {
			title: "Local Note",
			streamUrl: "Old/Local Note.mp3",
			url: "Old/Local Note.mp3",
			description: "",
			content: "",
			podcastName: "local file",
			filePath: "Old/Local Note.mp3",
		};
		localFiles.set({ ...emptyLocalFiles, episodes: [localEpisode] });
		// The file was moved: the recorded path no longer resolves to a file, and
		// the url has no http(s) scheme, so it must be treated as a vault path.
		setApp(() => null);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: "Old/Local Note.mp3",
				episodeName: "Local Note",
				time: "15",
			},
			api as never,
		);

		expect(get(currentEpisode)).toMatchObject({ title: "Local Note" });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: "local file::Local Note",
			time: 15,
		});
		// A schemeless path must never hit the feed parser.
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("shows a notice and changes nothing when the episode cannot be found", async () => {
		mockGetEpisodes.mockResolvedValue([]);

		await expect(
			podNotesURIHandler(
				{
					action: "podnotes",
					url: testFeedUrl,
					episodeName: "Nonexistent Episode",
					time: "10",
				},
				api as never,
			),
		).resolves.toBeUndefined();

		expect(get(currentEpisode)).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
	});

	test("does not reject when feed parsing throws (no silent unhandled rejection)", async () => {
		mockGetEpisodes.mockRejectedValue(new Error("network down"));

		await expect(
			podNotesURIHandler(
				{
					action: "podnotes",
					url: testFeedUrl,
					episodeName: "Anything",
					time: "10",
				},
				api as never,
			),
		).resolves.toBeUndefined();

		expect(get(currentEpisode)).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
	});

	test("picks the '+'-variant feed episode (raw-first) even when its space-twin precedes it", async () => {
		const spaceVariant: Episode = {
			...testEpisode,
			title: "A B",
			url: "https://pod.example.com/space",
			streamUrl: "https://pod.example.com/space.mp3",
		};
		const plusVariant: Episode = {
			...testEpisode,
			title: "A+B",
			url: "https://pod.example.com/plus",
			streamUrl: "https://pod.example.com/plus.mp3",
		};
		// Space-twin first: an order-insensitive (membership) match would wrongly pick it.
		mockGetEpisodes.mockResolvedValue([spaceVariant, plusVariant]);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: "A+B",
				time: "75",
			},
			api as never,
		);

		expect(get(currentEpisode)).toMatchObject({ title: "A+B" });
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${plusVariant.podcastName}::A+B`,
			time: 75,
		});
	});

	test("reopens a non-loaded episode without a timestamp and resumes from the saved location (#35)", async () => {
		playedEpisodes.setEpisodeTime(testEpisode, 321, 3600, false);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				// No `time`: the {{episodelink}} template tag omits it.
			},
			api as never,
		);

		expect(mockGetEpisodes).toHaveBeenCalledWith(testFeedUrl);
		expect(get(currentEpisode)).toMatchObject({ title: testEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);
		// The resume point is resolved from saved progress and armed explicitly, so
		// the player seeks to 321s — and any stale pending request can't override it.
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 321,
		});
	});

	test("a no-timestamp link overrides a stale pending seek for the same episode (#35)", async () => {
		playedEpisodes.setEpisodeTime(testEpisode, 321, 3600, false);
		// A previous timestamp link left a pending seek that has not been applied
		// (metadata still loading). The resume link must win, not the stale 999.
		requestedPlaybackTime.set({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 999,
		});

		await podNotesURIHandler(
			{ action: "podnotes", url: testFeedUrl, episodeName: testEpisode.title },
			api as never,
		);

		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 321,
		});
	});

	test("restarts a finished episode from the beginning for a no-timestamp link (#35)", async () => {
		// A finished episode is stored at its end; resuming there would auto-advance.
		playedEpisodes.markAsPlayed(testEpisode);
		playedEpisodes.setEpisodeTime(testEpisode, 3600, 3600, true);

		await podNotesURIHandler(
			{ action: "podnotes", url: testFeedUrl, episodeName: testEpisode.title },
			api as never,
		);

		expect(get(currentEpisode)).toMatchObject({ title: testEpisode.title });
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 0,
		});
	});

	test("restarts an already-loaded finished episode from the beginning for a no-timestamp link (#35)", async () => {
		currentEpisode.set(testEpisode);
		viewState.set(ViewState.PodcastGrid);
		duration.set(180);
		currentTime.set(180); // sitting at the very end
		isPaused.set(true);

		await podNotesURIHandler(
			{ action: "podnotes", url: testFeedUrl, episodeName: testEpisode.title },
			api as never,
		);

		expect(get(viewState)).toBe(ViewState.Player);
		expect(get(currentTime)).toBe(0);
		expect(get(isPaused)).toBe(false);
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("surfaces the player and resumes the already-loaded episode without seeking when no timestamp is given (#35)", async () => {
		currentEpisode.set(testEpisode);
		viewState.set(ViewState.PodcastGrid);
		currentTime.set(1234);
		isPaused.set(true);

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
			},
			api as never,
		);

		expect(get(viewState)).toBe(ViewState.Player);
		// The live position is already the last played location — left untouched.
		expect(get(currentTime)).toBe(1234);
		expect(get(isPaused)).toBe(false);
		expect(get(requestedPlaybackTime)).toBeNull();
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("treats an empty timestamp the same as an omitted one (resume, not error) (#35)", async () => {
		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "",
			},
			api as never,
		);

		expect(get(currentEpisode)).toMatchObject({ title: testEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);
		// No saved progress for this episode → resume from the start.
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: `${testEpisode.podcastName}::${testEpisode.title}`,
			time: 0,
		});
	});

	test("still rejects a present-but-non-numeric timestamp", async () => {
		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "not-a-number",
			},
			api as never,
		);

		expect(get(currentEpisode)).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("rejects a segment end without a start timestamp", async () => {
		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				endTime: "20",
			},
			api as never,
		);

		expect(get(currentEpisode)).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
		expect(get(activePlaybackSegment)).toBeNull();
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("rejects a segment end before the start timestamp", async () => {
		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "20",
				endTime: "20",
			},
			api as never,
		);

		expect(get(currentEpisode)).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
		expect(get(activePlaybackSegment)).toBeNull();
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("rejects a negative plain (non-segment) timestamp", async () => {
		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "-10",
			},
			api as never,
		);

		expect(get(currentEpisode)).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("rejects a negative segment start timestamp", async () => {
		await podNotesURIHandler(
			{
				action: "podnotes",
				url: testFeedUrl,
				episodeName: testEpisode.title,
				time: "-10",
				endTime: "5",
			},
			api as never,
		);

		expect(get(currentEpisode)).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
		expect(get(activePlaybackSegment)).toBeNull();
		expect(mockGetEpisodes).not.toHaveBeenCalled();
	});

	test("picks the '+'-variant local file (raw-first) even when its space-twin precedes it", async () => {
		const makeLocal = (title: string): LocalEpisode => ({
			title,
			streamUrl: `${title}.mp3`,
			url: `${title}.mp3`,
			description: "",
			content: "",
			podcastName: "local file",
			filePath: `${title}.mp3`,
		});
		localFiles.set({
			...emptyLocalFiles,
			episodes: [makeLocal("A B"), makeLocal("A+B")],
		});
		setApp((path) => (path === "A+B.mp3" ? {} : null));

		await podNotesURIHandler(
			{
				action: "podnotes",
				url: "A+B.mp3",
				episodeName: "A+B",
				time: "20",
			},
			api as never,
		);

		expect(get(currentEpisode)).toMatchObject({ title: "A+B" });
		expect(get(requestedPlaybackTime)).toEqual({
			episodeKey: "local file::A+B",
			time: 20,
		});
	});
});
