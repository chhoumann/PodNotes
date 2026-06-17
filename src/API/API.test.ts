import { TFile } from "obsidian";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { API } from "./API";
import {
	activePlaybackSegment,
	currentEpisode,
	currentTime,
	downloadedEpisodes,
	playbackRate,
	plugin,
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
	playbackRate.set(1);
	plugin.set({
		settings: {
			defaultPlaybackRate: 1.8,
		},
	} as never);
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

describe("API playback rate controls", () => {
	test("increases and decreases the runtime playback rate in tenth steps", () => {
		const api = new API();

		api.increasePlaybackRate();
		expect(get(playbackRate)).toBe(1.1);

		api.decreasePlaybackRate();
		api.decreasePlaybackRate();
		expect(get(playbackRate)).toBe(0.9);
	});

	test("clamps playback rate changes to the player-supported range", () => {
		const api = new API();

		api.playbackRate = 3.95;
		api.increasePlaybackRate();
		expect(api.playbackRate).toBe(4);

		api.playbackRate = 0.55;
		api.decreasePlaybackRate();
		expect(api.playbackRate).toBe(0.5);
	});

	test("resets playback rate to the configured default", () => {
		const api = new API();

		api.playbackRate = 2.5;
		api.resetPlaybackRate();

		expect(api.playbackRate).toBe(1.8);
	});
});

describe("API transcript access", () => {
	function setTranscriptVault(files: Record<string, string>) {
		const createTFile = (path: string): TFile =>
			Object.assign(new TFile(), { path });
		const getAbstractFileByPath = vi.fn((path: string) =>
			Object.prototype.hasOwnProperty.call(files, path)
				? createTFile(path)
				: null,
		);
		const read = vi.fn(async (file: TFile) => files[file.path] ?? "");

		plugin.set({
			settings: {
				defaultPlaybackRate: 1.8,
				transcript: {
					path: "Transcripts/{{podcast}}/{{title}}.md",
				},
			},
			app: {
				vault: {
					getAbstractFileByPath,
					read,
				},
			},
		} as never);

		return { getAbstractFileByPath, read };
	}

	test("returns null when no episode is loaded", async () => {
		setTranscriptVault({});
		const api = new API();

		await expect(api.getTranscript()).resolves.toBeNull();
	});

	test("returns null when the current episode has no generated transcript file", async () => {
		currentEpisode.set(feedEpisode);
		const { getAbstractFileByPath, read } = setTranscriptVault({});
		const api = new API();

		await expect(api.getTranscript()).resolves.toBeNull();

		expect(getAbstractFileByPath).toHaveBeenCalledWith(
			"Transcripts/Feed Podcast/Feed Episode.md",
		);
		expect(read).not.toHaveBeenCalled();
	});

	test("reads the generated transcript note for the current episode", async () => {
		currentEpisode.set(feedEpisode);
		const transcript = "# Feed Episode\n\nTranscript body for AI macros.";
		const { read } = setTranscriptVault({
			"Transcripts/Feed Podcast/Feed Episode.md": transcript,
		});
		const api = new API();

		await expect(api.getTranscript()).resolves.toBe(transcript);
		await expect(api.transcript).resolves.toBe(transcript);

		expect(read).toHaveBeenCalledWith(
			expect.objectContaining({
				path: "Transcripts/Feed Podcast/Feed Episode.md",
			}),
		);
	});

	test("reads the generated transcript note for an explicit episode", async () => {
		currentEpisode.set(feedEpisode);
		const transcript = "Local episode transcript";
		const { getAbstractFileByPath } = setTranscriptVault({
			"Transcripts/local file/Local Episode.md": transcript,
		});
		const api = new API();

		await expect(api.getTranscript(localEpisode)).resolves.toBe(transcript);

		expect(getAbstractFileByPath).toHaveBeenCalledWith(
			"Transcripts/local file/Local Episode.md",
		);
	});
});
