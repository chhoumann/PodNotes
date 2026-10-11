import { TFile, type Vault } from "obsidian";
import { get } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { API } from "./API";
import { DEFAULT_SETTINGS } from "src/constants";
import { PlayerController } from "src/player/PlayerController";
import { downloadedEpisodes, playedEpisodes, plugin, queue } from "src/store";
import type { Episode } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import type { LocalEpisode } from "src/types/LocalEpisode";
import { FakeDocument } from "../../tests/mocks/fakeMedia";

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

function setup(settings: Partial<IPodNotesSettings> = {}, vault: Partial<Vault> = {}) {
	const doc = new FakeDocument();
	const host = {
		settings: { ...structuredClone(DEFAULT_SETTINGS), defaultPlaybackRate: 1.8, ...settings },
		app: { vault: vault as Vault },
		checkpoint: (update: () => void) => update(),
		saveSettings: vi.fn(() => Promise.resolve()),
	};
	const player = new PlayerController(doc.asPlayerDocument(), host);
	plugin.set({ ...host, player } as never);
	return { api: new API(), player, media: () => doc.media };
}

/** Plays the feed episode from `time`, with its metadata loaded. */
function playingAt(time: number, duration = 3600, settings: Partial<IPodNotesSettings> = {}) {
	const context = setup(settings);
	context.player.play(feedEpisode, { time });
	context.media().duration = duration;
	context.media().emit("loadedmetadata");
	return context;
}

beforeEach(() => {
	downloadedEpisodes.set({});
	playedEpisodes.set({});
	queue.set({ ...structuredClone(DEFAULT_SETTINGS.queue), episodes: [] });
});

describe("API.getPodcastSegmentFormatted", () => {
	test("formats a plain segment range", () => {
		const { api, player } = setup();
		player.restore(feedEpisode);

		expect(api.getPodcastSegmentFormatted("HH:mm:ss", 115, 125)).toBe("00:01:55-00:02:05");
	});

	test("links feed episodes with start and end times", () => {
		const { api, player } = setup();
		player.restore(feedEpisode);

		const rendered = api.getPodcastSegmentFormatted("HH:mm:ss", 115, 125, true);

		expect(rendered).toContain("[00:01:55-00:02:05]");
		expect(rendered).toContain("time=115");
		expect(rendered).toContain("endTime=125");
		expect(rendered).toContain("url=https%3A%2F%2Fpod.example.com%2Ffeed.xml");
	});

	test("links a local episode by the file it plays, not a later same-named one", () => {
		const { api, player } = setup();
		player.restore(localEpisode);
		downloadedEpisodes.set({
			[localEpisode.podcastName]: [
				{ ...localEpisode, filePath: "Other/Local Episode.mp3", size: 1 },
			],
		});

		const rendered = api.getPodcastSegmentFormatted("HH:mm:ss", 1, 2, true);

		expect(rendered).toContain("url=Audio%2FLocal%20Episode.mp3");
		expect(rendered).toContain("time=1");
		expect(rendered).toContain("endTime=2");
	});

	test("links a local episode without a path by its registered file", () => {
		const { api, player } = setup();
		player.restore({ ...localEpisode, filePath: undefined } as Episode);
		downloadedEpisodes.set({
			[localEpisode.podcastName]: [
				{ ...localEpisode, filePath: "Audio/Local Episode.mp3", size: 1 },
			],
		});

		expect(api.getPodcastTimeFormatted("HH:mm:ss", true)).toContain(
			"url=Audio%2FLocal%20Episode.mp3",
		);
	});

	test("does not link invalid segment ranges", () => {
		const { api, player } = setup();
		player.restore(feedEpisode);

		expect(api.getPodcastSegmentFormatted("HH:mm:ss", 125, 125, true)).toBe(
			"00:02:05-00:02:05",
		);
		expect(api.getPodcastSegmentFormatted("HH:mm:ss", 126, 125, true)).toBe(
			"00:02:06-00:02:05",
		);
		expect(api.getPodcastSegmentFormatted("HH:mm:ss", 125, Number.NaN, true)).toBe(
			"00:02:05-00:00:00",
		);
	});

	test("seeking through the public API ends a segment link's stop", () => {
		const { api, player, media } = setup();
		player.play(feedEpisode, { time: 115, endTime: 125 });
		media().duration = 3600;
		media().emit("loadedmetadata");

		api.currentTime = 500;
		media().currentTime = 600;
		media().emit("timeupdate");

		expect(api.currentTime).toBe(600);
		expect(media().paused).toBe(false);
		expect(get(playedEpisodes)["Feed Podcast::Feed Episode"]?.time).toBe(600);
	});
});

describe("API playback rate controls", () => {
	test("increases and decreases the runtime playback rate in tenth steps", () => {
		const { api, media } = setup({ defaultPlaybackRate: 1 });

		api.increasePlaybackRate();
		expect(api.playbackRate).toBe(1.1);

		api.decreasePlaybackRate();
		api.decreasePlaybackRate();
		expect(api.playbackRate).toBe(0.9);
		expect(media().playbackRate).toBe(0.9);
	});

	test("clamps playback rate changes to the player-supported range", () => {
		const { api } = setup();

		api.playbackRate = 3.95;
		api.increasePlaybackRate();
		expect(api.playbackRate).toBe(4);

		api.playbackRate = 0.55;
		api.decreasePlaybackRate();
		expect(api.playbackRate).toBe(0.5);
	});

	test("resets playback rate to the configured default", () => {
		const { api } = setup();

		api.playbackRate = 2.5;
		api.resetPlaybackRate();

		expect(api.playbackRate).toBe(1.8);
	});
});

describe("API skip controls (PB-02)", () => {
	const lengths = { skipBackwardLength: 15, skipForwardLength: 30 };

	test("skips backward and forward by the configured lengths", () => {
		const { api, media } = playingAt(100, 3600, lengths);

		api.skipBackward();
		expect(api.currentTime).toBe(85);

		api.skipForward();
		expect(api.currentTime).toBe(115);
		expect(media().currentTime).toBe(115);
	});

	test("never seeks before 0 when skipping backward past the start", () => {
		const { api } = playingAt(5, 3600, lengths);

		api.skipBackward();
		expect(api.currentTime).toBe(0);
	});

	test("falls back to a 15s default when a skip length is NaN/invalid", () => {
		const { api } = playingAt(100, 3600, {
			skipBackwardLength: Number.NaN,
			skipForwardLength: undefined as unknown as number,
		});

		api.skipBackward();
		expect(api.currentTime).toBe(85);

		api.skipForward();
		expect(api.currentTime).toBe(100);
	});

	test("clamps a forward skip just short of the end so it doesn't auto-advance", () => {
		const { api, media } = playingAt(100, 110, lengths);

		api.skipForward();
		// 100 + 30 = 130, clamped to duration - 0.25.
		expect(api.currentTime).toBe(109.75);
		expect(media().paused).toBe(false);
	});

	test("does not rewind on a forward skip when already within the last 0.25s (#213)", () => {
		const { api } = playingAt(9.9, 10, lengths);

		api.skipForward();
		// The end-clamp (dur - 0.25 = 9.75) must never move a forward skip backward.
		expect(api.currentTime).toBe(9.9);
	});

	test("leaves the forward target unclamped when duration is unknown", () => {
		const { api, player } = setup(lengths);
		player.restore(feedEpisode);
		api.currentTime = 100;

		api.skipForward();
		expect(api.currentTime).toBe(130);
	});
});

describe("API playback", () => {
	test("start resumes the restored episode, stop pauses it, and toggle flips it", () => {
		playedEpisodes.set({
			"Feed Podcast::Feed Episode": {
				title: feedEpisode.title,
				podcastName: feedEpisode.podcastName,
				time: 42,
				duration: 3600,
				finished: false,
			},
		});
		const { api, player, media } = setup();
		player.restore(feedEpisode);
		expect(api.isPlaying).toBe(false);
		expect(api.length).toBe(3600);

		api.start();
		expect(api.isPlaying).toBe(true);
		expect(media().src).toBe(feedEpisode.streamUrl);

		api.stop();
		expect(api.isPlaying).toBe(false);
		expect(media().paused).toBe(true);

		api.togglePlayback();
		expect(api.isPlaying).toBe(true);
		expect(media().paused).toBe(false);
	});

	test("start() then stop() on loaded media leaves it paused", () => {
		const { api, player, media } = playingAt(100);
		player.pause();

		api.start();
		expect(api.isPlaying).toBe(true);
		api.stop();
		media().emit("play");

		expect(api.isPlaying).toBe(false);
		expect(media().paused).toBe(true);
	});

	test("a seek before anything loads reads back at once", () => {
		const { api, player } = setup();
		player.restore(feedEpisode);

		api.currentTime = 125;

		expect(api.currentTime).toBe(125);
	});

	test("ignores a seek to a time that is not a number of seconds", () => {
		const { api } = playingAt(100);

		api.currentTime = Number.NaN;
		api.currentTime = -5;

		expect(api.currentTime).toBe(100);
	});

	test("start() while a segment plays leaves its stop in place", () => {
		playedEpisodes.set({
			"Feed Podcast::Feed Episode": {
				title: feedEpisode.title,
				podcastName: feedEpisode.podcastName,
				time: 1000,
				duration: 3600,
				finished: false,
			},
		});
		const { api, player, media } = setup();
		player.play(feedEpisode, { time: 100, endTime: 125 });
		media().duration = 3600;
		media().emit("loadedmetadata");

		api.start();
		media().currentTime = 130;
		media().emit("timeupdate");

		expect(media().currentTime).toBe(125);
		expect(media().paused).toBe(true);
		expect(get(playedEpisodes)["Feed Podcast::Feed Episode"]?.time).toBe(1000);
	});

	test("ignores an undefined seek before the metadata loads", () => {
		const { api, player, media } = setup();
		player.play(feedEpisode, { time: 115 });

		api.currentTime = undefined as unknown as number;
		media().duration = 3600;
		media().emit("loadedmetadata");

		expect(api.currentTime).toBe(115);
		expect(media().currentTime).toBe(115);
	});

	test("ignores an undefined seek during a segment, which still stops at its end", () => {
		const { api, player, media } = setup();
		player.play(feedEpisode, { time: 115, endTime: 125 });
		media().duration = 3600;
		media().emit("loadedmetadata");

		api.currentTime = undefined as unknown as number;
		media().currentTime = 126;
		media().emit("timeupdate");

		expect(media().currentTime).toBe(125);
		expect(media().paused).toBe(true);
		expect(get(playedEpisodes)["Feed Podcast::Feed Episode"]).toBeUndefined();
	});
});

describe("API volume (AP-07)", () => {
	test("clamps volume into [0, 1]", () => {
		const { api, media } = setup();

		api.volume = 2;
		expect(api.volume).toBe(1);

		api.volume = -1;
		expect(api.volume).toBe(0);
		expect(media().volume).toBe(0);
	});

	test("ignores a non-finite volume (keeps the current value) instead of poisoning it to NaN", () => {
		const { api } = setup();
		api.volume = 0.6;

		api.volume = Number.NaN;
		expect(api.volume).toBe(0.6);
	});
});

describe("API transcript access", () => {
	function setTranscriptVault(files: Record<string, string>) {
		const createTFile = (path: string): TFile => Object.assign(new TFile(), { path });
		const getAbstractFileByPath = vi.fn((path: string) =>
			Object.prototype.hasOwnProperty.call(files, path) ? createTFile(path) : null,
		);
		const read = vi.fn(async (file: TFile) => files[file.path] ?? "");
		const { api, player } = setup(
			{
				transcript: {
					...DEFAULT_SETTINGS.transcript,
					path: "Transcripts/{{podcast}}/{{title}}.md",
				},
			},
			{ getAbstractFileByPath, read } as unknown as Partial<Vault>,
		);

		return { api, player, getAbstractFileByPath, read };
	}

	test("returns null when no episode is loaded", async () => {
		const { api } = setTranscriptVault({});

		await expect(api.getTranscript()).resolves.toBeNull();
	});

	test("returns null when the current episode has no generated transcript file", async () => {
		const { api, player, getAbstractFileByPath, read } = setTranscriptVault({});
		player.restore(feedEpisode);

		await expect(api.getTranscript()).resolves.toBeNull();

		expect(getAbstractFileByPath).toHaveBeenCalledWith(
			"Transcripts/Feed Podcast/Feed Episode.md",
		);
		expect(read).not.toHaveBeenCalled();
	});

	test("reads the generated transcript note for the current episode", async () => {
		const transcript = "# Feed Episode\n\nTranscript body for AI macros.";
		const { api, player, read } = setTranscriptVault({
			"Transcripts/Feed Podcast/Feed Episode.md": transcript,
		});
		player.restore(feedEpisode);

		await expect(api.getTranscript()).resolves.toBe(transcript);
		await expect(api.transcript).resolves.toBe(transcript);

		expect(read).toHaveBeenCalledWith(
			expect.objectContaining({
				path: "Transcripts/Feed Podcast/Feed Episode.md",
			}),
		);
	});

	test("reads the generated transcript note for an explicit episode", async () => {
		const transcript = "Local episode transcript";
		const { api, player, getAbstractFileByPath } = setTranscriptVault({
			"Transcripts/local file/Local Episode.md": transcript,
		});
		player.restore(feedEpisode);

		await expect(api.getTranscript(localEpisode)).resolves.toBe(transcript);

		expect(getAbstractFileByPath).toHaveBeenCalledWith(
			"Transcripts/local file/Local Episode.md",
		);
	});
});
