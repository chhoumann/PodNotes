import { beforeEach, describe, expect, test } from "vitest";
import { get } from "svelte/store";
import { API } from "./API";
import {
	currentEpisode,
	currentTime,
	activePlaybackSegment,
	downloadedEpisodes,
} from "src/store";
import type { Episode } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";

const feedEpisode: Episode = {
	title: "Feed Episode",
	streamUrl: "https://pod.example.com/audio.mp3",
	url: "https://pod.example.com/episode",
	description: "",
	content: "",
	podcastName: "Feed Podcast",
	feedUrl: "https://pod.example.com/feed.xml",
};

const localEpisode: LocalEpisode = {
	title: "Local Episode",
	streamUrl: "Audio/Local Episode.mp3",
	url: "Audio/Local Episode.mp3",
	description: "",
	content: "",
	podcastName: "local file",
	filePath: "Audio/Local Episode.mp3",
};

beforeEach(() => {
	currentEpisode.update(() => undefined as unknown as Episode);
	currentTime.set(0);
	activePlaybackSegment.set(null);
	downloadedEpisodes.set({});
});

describe("API.getPodcastSegmentFormatted", () => {
	test("formats a plain segment range", () => {
		currentEpisode.set(feedEpisode);
		const api = new API();

		expect(api.getPodcastSegmentFormatted("HH:mm:ss", 115, 125)).toBe(
			"00:01:55-00:02:05",
		);
	});

	test("links feed episodes with start and end times", () => {
		currentEpisode.set(feedEpisode);
		const api = new API();

		const rendered = api.getPodcastSegmentFormatted(
			"HH:mm:ss",
			115,
			125,
			true,
		);

		expect(rendered).toContain("[00:01:55-00:02:05]");
		expect(rendered).toContain("time=115");
		expect(rendered).toContain("endTime=125");
		expect(rendered).toContain("url=https%3A%2F%2Fpod.example.com%2Ffeed.xml");
	});

	test("links downloaded local episodes by file path", () => {
		currentEpisode.set(localEpisode);
		downloadedEpisodes.set({
			[localEpisode.podcastName]: [
				{
					...localEpisode,
					filePath: "Audio/Local Episode.mp3",
					size: 1,
				},
			],
		});
		const api = new API();

		const rendered = api.getPodcastSegmentFormatted("HH:mm:ss", 1, 2, true);

		expect(rendered).toContain("url=Audio%2FLocal%20Episode.mp3");
		expect(rendered).toContain("time=1");
		expect(rendered).toContain("endTime=2");
	});

	test("does not link invalid segment ranges", () => {
		currentEpisode.set(feedEpisode);
		const api = new API();

		expect(api.getPodcastSegmentFormatted("HH:mm:ss", 125, 125, true)).toBe(
			"00:02:05-00:02:05",
		);
		expect(api.getPodcastSegmentFormatted("HH:mm:ss", 126, 125, true)).toBe(
			"00:02:06-00:02:05",
		);
		expect(
			api.getPodcastSegmentFormatted("HH:mm:ss", 125, Number.NaN, true),
		).toBe("00:02:05-00:00:00");
	});

	test("seeking through the public API clears an active playback segment", () => {
		currentEpisode.set(feedEpisode);
		activePlaybackSegment.set({
			episodeKey: `${feedEpisode.podcastName}::${feedEpisode.title}`,
			startTime: 115,
			endTime: 125,
		});
		const api = new API();

		api.currentTime = 500;

		expect(api.currentTime).toBe(500);
		expect(get(activePlaybackSegment)).toBeNull();
	});
});
