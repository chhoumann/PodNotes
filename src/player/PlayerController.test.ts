import type { Vault } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_SETTINGS } from "src/constants";
import { downloadedEpisodes, playedEpisodes, playlists, queue } from "src/store";
import type { Episode } from "src/types/Episode";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { getEpisodeKey } from "src/utility/episodeKey";
import { FakeDocument, FakeParent, type FakeMedia } from "../../tests/mocks/fakeMedia";
import { PlayerController } from "./PlayerController";

const episode = (title: string, extra: Partial<Episode> = {}): Episode => ({
	title,
	podcastName: "Show",
	streamUrl: `https://cdn.example.com/${title}.mp3`,
	url: "",
	description: "",
	content: "",
	...extra,
});

const A = episode("A");
const B = episode("B");
const C = episode("C");
const VIDEO = episode("V", { streamUrl: "https://cdn.example.com/V.mp4", mediaType: "video" });

let now = 0;
const subscriptions: Array<() => void> = [];

function setup(settings: Partial<IPodNotesSettings> = {}) {
	const doc = new FakeDocument();
	let inCheckpoint = false;
	const host = {
		settings: { ...structuredClone(DEFAULT_SETTINGS), ...settings },
		app: { vault: { getAbstractFileByPath: () => null } as unknown as Vault },
		checkpoint: vi.fn((update: () => void) => {
			inCheckpoint = true;
			try {
				update();
			} finally {
				inCheckpoint = false;
			}
		}),
		saveSettings: vi.fn(() => Promise.resolve()),
	};
	const player = new PlayerController(doc.asPlayerDocument(), host);
	/** Every progress write for `ep`, and whether it went through a checkpoint. */
	const writes = (ep: Episode) => {
		const seen: Array<{ time: number; finished: boolean; checkpoint: boolean }> = [];
		let initial = true;
		const unsubscribe = playedEpisodes.subscribe((played) => {
			const record = played[getEpisodeKey(ep)];
			if (!initial && record) {
				seen.push({
					time: record.time,
					finished: record.finished,
					checkpoint: inCheckpoint,
				});
			}
		});
		initial = false;
		subscriptions.push(unsubscribe);
		return seen;
	};
	return {
		doc,
		host,
		player,
		writes,
		media: () => doc.media,
		state: () => get(player.state),
	};
}

function saved(ep: Episode, time: number, duration = 3600, finished = false) {
	playedEpisodes.update((played) => ({
		...played,
		[getEpisodeKey(ep)]: {
			title: ep.title,
			podcastName: ep.podcastName,
			time,
			duration,
			finished,
		},
	}));
}

const progress = (ep: Episode) => get(playedEpisodes)[getEpisodeKey(ep)];
const queued = () => get(queue).episodes.map((e) => e.title);

function metadata(media: FakeMedia, duration = 3600) {
	media.duration = duration;
	media.emit("loadedmetadata");
}

function reach(media: FakeMedia, time: number, at = now) {
	now = at;
	media.currentTime = time;
	media.emit("timeupdate");
}

/** The browser pauses on its own, as at a natural end or from a headset. */
function pausedByBrowser(media: FakeMedia) {
	media.paused = true;
	media.emit("pause");
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	now = 0;
	vi.spyOn(Date, "now").mockImplementation(() => now);
	playedEpisodes.set({});
	playlists.set({});
	downloadedEpisodes.set({});
	queue.set({ ...structuredClone(DEFAULT_SETTINGS.queue), episodes: [] });
});

afterEach(() => {
	for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
	vi.restoreAllMocks();
});

describe("restore", () => {
	test("shows the saved position paused without loading media or writing settings (#377)", () => {
		saved(A, 1234, 3600);
		const { player, host, media, state } = setup();

		player.restore(A);

		expect(state()).toMatchObject({
			status: "restored",
			episode: A,
			currentTime: 1234,
			duration: 3600,
		});
		expect(media().src).toBe("");
		expect(media().paused).toBe(true);
		expect(host.saveSettings).not.toHaveBeenCalled();
		expect(host.settings.currentEpisode).toBeUndefined();
	});

	test("shows a finished episode at its start", () => {
		saved(A, 3600, 3600, true);
		const { player, state } = setup();

		player.restore(A);

		expect(state().currentTime).toBe(0);
	});

	test("uses the feed's duration when nothing was saved", () => {
		const { player, state } = setup();

		player.restore({ ...A, duration: 1800 });

		expect(state()).toMatchObject({ currentTime: 0, duration: 1800 });
	});

	test("again, after a sync, shows the synced progress and resumes from it", () => {
		saved(A, 600, 3600);
		const { player, host, media, state } = setup();
		player.restore(A);

		saved(A, 2400, 3600);
		player.restore(A);
		expect(state()).toMatchObject({ status: "restored", episode: A, currentTime: 2400 });
		expect(media().src).toBe("");
		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(2400);
		expect(host.saveSettings).not.toHaveBeenCalled();
	});

	test("again, after a sync, shows the synced selection, even after a seek", () => {
		saved(B, 300, 1800);
		const { player, state } = setup();
		player.restore(A);
		player.seek(900);

		player.restore(B);

		expect(state()).toMatchObject({
			status: "restored",
			episode: B,
			currentTime: 300,
			duration: 1800,
		});
	});

	const starts = [
		["resume()", (player: PlayerController) => player.resume()],
		["play()", (player: PlayerController) => player.play(A)],
	] as const;

	test.each(starts)(
		"again, after an unrelated sync, %s starts where the user moved it",
		(_, start) => {
			saved(A, 600, 3600);
			const { player, media, state } = setup();
			player.restore(A);
			player.seek(900);

			player.restore(A);
			expect(state()).toMatchObject({ status: "restored", currentTime: 900 });
			start(player);
			metadata(media());

			expect(media().currentTime).toBe(900);
		},
	);

	test.each(starts)(
		"after a failed first play, %s starts at the progress a sync brought",
		(_, start) => {
			saved(A, 600, 3600);
			const { player, media } = setup();
			player.restore(A);
			player.resume();
			media().emit("error");

			saved(A, 2400, 3600);
			player.restore(A);
			start(player);
			metadata(media());

			expect(media().currentTime).toBe(2400);
		},
	);

	test("leaves loaded media alone", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 40);

		player.restore(B);

		expect(state()).toMatchObject({ status: "playing", episode: A, currentTime: 40 });
		expect(media().src).toBe(A.streamUrl);
		expect(media().paused).toBe(false);
	});
});

describe("switching episodes (#353)", () => {
	test("never overwrites the restored episode's position when another is played first", () => {
		saved(A, 1234, 3600);
		const { player, host, media, state } = setup();
		player.restore(A);

		player.play(B);
		player.play(C);

		expect(progress(A)).toMatchObject({ time: 1234, duration: 3600, finished: false });
		expect(progress(B)).toBeUndefined();
		expect(host.settings.currentEpisode).toBe(C);
		expect(queued()).toEqual(["B", "A"]);
		expect(state()).toMatchObject({ status: "loading", episode: C });
		expect(media().src).toBe(C.streamUrl);

		player.play(A);
		metadata(media());
		expect(media().currentTime).toBe(1234);
	});

	test("does not queue the episode switched away from when the queue is not automatic", () => {
		const { player } = setup({ autoQueue: false });
		player.restore(A);

		player.play(B);

		expect(queued()).toEqual([]);
	});

	test("saves the position of the episode it was playing", () => {
		const { player, media } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 42);

		player.play(B);

		expect(progress(A)).toMatchObject({ time: 42, finished: false });
		expect(media().paused).toBe(false);
		expect(media().src).toBe(B.streamUrl);
	});

	test("does not queue an episode that just ended", () => {
		const { player, media } = setup();
		player.play(A);
		metadata(media(), 60);
		pausedByBrowser(media());
		media().emit("ended");

		player.play(B);

		expect(queued()).toEqual([]);
	});

	test("reloads the same episode when its media changed, without queueing it", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 42);

		player.play({ ...A, streamUrl: "https://cdn.example.com/A-v2.mp3" });

		expect(media().src).toBe("https://cdn.example.com/A-v2.mp3");
		expect(state().status).toBe("loading");
		expect(progress(A)?.time).toBe(42);
		expect(queued()).toEqual([]);
		metadata(media());
		expect(media().currentTime).toBe(42);
	});

	test("stops the episode it was playing when the next one's file is missing", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 42);

		player.play({ ...B, filePath: "Missing/B.mp3" } as Episode);

		expect(media().paused).toBe(true);
		expect(media().src).toBe("");
		expect(state()).toMatchObject({ status: "error", episode: { title: "B" } });
		expect(progress(A)?.time).toBe(42);
	});
});

describe("a new load shows its own position and length until its metadata loads (#94)", () => {
	test("after a switch away from a playing episode", () => {
		saved(B, 300, 1800);
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 42);

		player.play(B);

		expect(state()).toMatchObject({
			status: "loading",
			episode: B,
			currentTime: 300,
			duration: 1800,
		});
	});

	test("after the queue advances at a natural end", () => {
		const next = episode("N", { duration: 900 });
		queue.set({ ...get(queue), episodes: [next] });
		const { player, media, state } = setup();
		player.play(A);
		metadata(media(), 60);
		reach(media(), 60);
		pausedByBrowser(media());

		media().emit("ended");

		expect(state()).toMatchObject({
			status: "loading",
			episode: next,
			currentTime: 0,
			duration: 900,
		});
	});

	test("with no saved or feed length, zero", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 42);

		player.play(B);

		expect(state()).toMatchObject({ currentTime: 0, duration: 0 });
	});
});

describe("stale events", () => {
	test("ignores events from an element a video replaced", () => {
		const { player, doc, state } = setup();
		player.play(A);
		const audio = doc.media;
		metadata(audio);

		player.play(VIDEO);
		const before = state();
		audio.currentTime = 10;
		audio.emit("timeupdate");
		audio.emit("ended");
		audio.emit("error");

		expect(doc.media).not.toBe(audio);
		expect(doc.media.tagName).toBe("VIDEO");
		expect(audio.parentNode).toBeNull();
		expect(state()).toEqual(before);
		expect(progress(A)?.finished).toBe(false);
	});

	test("ignores the rejection of an earlier load's play()", async () => {
		const { player, media, state } = setup();
		player.play(A);

		player.play(B);
		await flush();

		expect(state().status).toBe("loading");
		metadata(media());
		expect(state().status).toBe("playing");
	});
});

describe("play() rejected", () => {
	test("leaves the player paused and writes no progress", async () => {
		saved(A, 100, 3600);
		const { player, media, state, writes } = setup();
		const written = writes(A);
		player.play(A);

		media().paused = true;
		media().plays[0].reject(new DOMException("Blocked", "NotAllowedError"));
		await flush();
		expect(state().status).toBe("paused");

		metadata(media());
		expect(state().status).toBe("paused");
		expect(media().currentTime).toBe(100);
		expect(written).toEqual([]);
	});
});

describe("pause", () => {
	test("while loading cancels playing once the media is ready", () => {
		const { player, media, state, writes } = setup();
		const written = writes(A);
		player.play(A, { time: 30 });

		player.pause();
		metadata(media());

		expect(state().status).toBe("paused");
		expect(media().paused).toBe(true);
		expect(media().currentTime).toBe(30);
		expect(written).toEqual([]);
	});

	test("by the browser while loading still holds once the media is ready", async () => {
		const { player, media, state, writes } = setup();
		const written = writes(A);
		player.play(A, { time: 30 });

		media().pause();
		media().emit("pause");
		await flush();
		metadata(media());

		expect(state().status).toBe("paused");
		expect(media().paused).toBe(true);
		expect(written).toEqual([]);
	});

	test("saves the position at once", () => {
		const { player, media, state, writes } = setup();
		const written = writes(A);
		player.play(A);
		metadata(media());
		reach(media(), 137, 1000);

		player.pause();

		expect(state().status).toBe("paused");
		expect(written.at(-1)).toEqual({ time: 137, finished: false, checkpoint: false });
	});
});

describe("consecutive intents on loaded media, with no media event between them", () => {
	function pausedAfterMetadata() {
		const context = setup();
		context.player.play(A);
		metadata(context.media());
		context.player.pause();
		return context;
	}

	test("resume() then pause() leaves it paused", () => {
		const { player, media, state } = pausedAfterMetadata();

		player.resume();
		expect(state().status).toBe("playing");
		player.pause();
		media().emit("play");
		media().emit("pause");

		expect(media().paused).toBe(true);
		expect(state().status).toBe("paused");
	});

	test("toggle() twice leaves it paused", () => {
		const { player, media, state } = pausedAfterMetadata();

		player.toggle();
		player.toggle();
		media().emit("play");

		expect(media().paused).toBe(true);
		expect(state().status).toBe("paused");
	});

	test("resume() then a seek past the end pauses short of the end without finishing", () => {
		queue.set({ ...get(queue), episodes: [B] });
		const { player, media, state } = pausedAfterMetadata();

		player.resume();
		player.seek(1e9);
		media().emit("play");

		expect(media().paused).toBe(true);
		expect(media().currentTime).toBe(3599.75);
		expect(state().status).toBe("paused");
		expect(queued()).toEqual(["B"]);
	});
});

describe("natural end", () => {
	test("pausing near the end, then ending, marks played and advances the queue once", () => {
		queue.set({ ...get(queue), episodes: [B, C] });
		const otherShow = episode("A", { podcastName: "Other show" });
		playlists.set({
			Listen: {
				...structuredClone(DEFAULT_SETTINGS.queue),
				name: "Listen",
				episodes: [A, otherShow],
			},
		});
		const { player, host, media, state } = setup();
		player.play(A);
		metadata(media());

		reach(media(), 3599.9);
		pausedByBrowser(media());
		expect(progress(A)).toMatchObject({ time: 3599.9, finished: false });
		expect(queued()).toEqual(["B", "C"]);

		media().emit("ended");
		expect(progress(A)?.finished).toBe(true);
		expect(get(playlists).Listen.episodes).toEqual([otherShow]);
		expect(queued()).toEqual(["C"]);
		expect(host.settings.currentEpisode).toBe(B);
		expect(state()).toMatchObject({ status: "loading", episode: B });
		expect(media().src).toBe(B.streamUrl);
	});

	test("advances to the next episode at its saved position", () => {
		saved(B, 300, 3600);
		queue.set({ ...get(queue), episodes: [B] });
		const { player, media } = setup();
		player.play(A);
		metadata(media());

		pausedByBrowser(media());
		media().emit("ended");
		metadata(media());

		expect(media().currentTime).toBe(300);
		expect(media().paused).toBe(false);
	});

	test("stops at the end when the queue is not automatic", () => {
		queue.set({ ...get(queue), episodes: [B] });
		const { player, host, media, state } = setup({ autoQueue: false });
		player.play(A);
		metadata(media());

		pausedByBrowser(media());
		media().emit("ended");

		expect(state().status).toBe("ended");
		expect(queued()).toEqual(["B"]);
		expect(host.settings.currentEpisode).toBe(A);
		expect(media().src).toBe(A.streamUrl);
	});

	test("does its bookkeeping once per load", () => {
		const { player, media } = setup({ autoQueue: false });
		player.play(A);
		metadata(media());
		pausedByBrowser(media());
		media().emit("ended");

		playedEpisodes.markAsUnplayed(A);
		media().emit("ended");

		expect(progress(A)?.finished).toBe(false);
	});
});

describe("seek", () => {
	test("before the metadata loads lands where it asked once it does", () => {
		const { player, media, state } = setup();
		player.play(A, { time: 120 });

		expect(player.seek(300)).toBe(true);
		expect(state().currentTime).toBe(300);
		metadata(media());

		expect(media().currentTime).toBe(300);
	});

	test("rejects a time that is not a finite number of seconds", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 50);

		for (const time of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
			expect(player.seek(time)).toBe(false);
		}

		expect(media().currentTime).toBe(50);
		expect(state().currentTime).toBe(50);
	});

	test("past the end stops short of it and pauses, without finishing", () => {
		queue.set({ ...get(queue), episodes: [B] });
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());

		player.seek(99999);

		expect(media().currentTime).toBe(3599.75);
		expect(media().paused).toBe(true);
		expect(state().status).toBe("paused");
		expect(progress(A)?.finished).toBe(false);
		expect(queued()).toEqual(["B"]);
	});

	test("a pending start past the end stops short of it and pauses at the metadata", () => {
		const { player, media, state } = setup();
		player.play(A, { time: 99999 });

		metadata(media(), 60);

		expect(media().currentTime).toBe(59.75);
		expect(state().status).toBe("paused");
	});

	test("is kept as the start before anything loads", () => {
		const { player, media, state } = setup();
		player.restore(A);

		expect(player.seek(125)).toBe(true);
		expect(state().currentTime).toBe(125);
		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(125);
	});
});

describe("segment links", () => {
	test("pause at the segment's end and save no progress until a normal intent", () => {
		saved(A, 1000, 3600);
		const { player, media, state, writes } = setup();
		const written = writes(A);
		player.play(A, { time: 100, endTime: 125 });
		metadata(media());
		expect(media().currentTime).toBe(100);

		reach(media(), 110, 10_000);
		reach(media(), 126, 20_000);
		expect(media().currentTime).toBe(125);
		expect(media().paused).toBe(true);
		expect(state().status).toBe("paused");

		player.save();
		pausedByBrowser(media());
		expect(written).toEqual([]);

		player.seek(200);
		reach(media(), 200, 30_000);
		expect(written).toEqual([{ time: 200, finished: false, checkpoint: true }]);
	});

	test("ending at the media's end does not finish the episode", () => {
		queue.set({ ...get(queue), episodes: [B] });
		const { player, media, state } = setup();
		player.play(A, { time: 3590, endTime: 3600 });
		metadata(media());

		reach(media(), 3599.9);
		pausedByBrowser(media());
		media().emit("ended");

		expect(state().status).toBe("paused");
		expect(progress(A)).toBeUndefined();
		expect(queued()).toEqual(["B"]);
	});

	test("reject an end at or before the start", () => {
		const { player, state } = setup();

		expect(player.play(A, { time: 30, endTime: 30 })).toBe(false);
		expect(player.play(A, { endTime: 30 })).toBe(false);
		expect(player.play(A, { time: Number.NaN })).toBe(false);
		expect(state().status).toBe("empty");
	});
});

describe("progress", () => {
	test("is checkpointed about every 5 s while playing, and never before the metadata", () => {
		const { player, media, writes } = setup();
		const written = writes(A);
		player.play(A);
		reach(media(), 7, 0);
		pausedByBrowser(media());
		player.save();
		expect(written).toEqual([]);

		metadata(media());
		media().paused = false;
		for (let second = 1; second <= 11; second++) reach(media(), second, second * 1000);

		expect(written).toEqual([
			{ time: 1, finished: false, checkpoint: true },
			{ time: 6, finished: false, checkpoint: true },
			{ time: 11, finished: false, checkpoint: true },
		]);
	});

	test("save() writes the position at once", () => {
		const { player, media, writes } = setup();
		const written = writes(A);
		player.play(A);
		metadata(media());
		reach(media(), 3, 1000);

		media().currentTime = 4;
		player.save();

		expect(written.at(-1)).toEqual({ time: 4, finished: false, checkpoint: false });
	});

	test("is not written for a restored episode or after an error", () => {
		saved(A, 1234, 3600);
		const { player, media, state, writes } = setup();
		const written = writes(A);
		player.restore(A);
		player.save();
		player.play(A);
		metadata(media());
		reach(media(), 1300, 1000);
		written.length = 0;

		media().currentTime = 0;
		media().emit("error");
		player.save();
		player.play(B);

		expect(state().status).toBe("loading");
		expect(written).toEqual([]);
		expect(progress(A)?.time).toBe(1300);
	});
});

describe("selection", () => {
	test("only play() writes the selected episode; resume() continues without it", () => {
		const { player, host, media, state } = setup();
		host.settings.currentEpisode = A;
		player.restore(A);
		queue.set({ ...get(queue), episodes: [A] });
		host.settings.currentEpisode = C;

		player.resume();
		expect(state()).toMatchObject({ status: "loading", episode: A });
		expect(host.settings.currentEpisode).toBe(C);
		expect(queued()).toEqual(["A"]);

		metadata(media());
		player.play(A);
		expect(host.settings.currentEpisode).toBe(A);
		expect(queued()).toEqual([]);
	});

	test("play() of the episode already playing keeps its position", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 42);

		player.play(A);

		expect(media().src).toBe(A.streamUrl);
		expect(media().currentTime).toBe(42);
		expect(state().status).toBe("playing");
	});

	test("play() of an ended episode starts it over", () => {
		const { player, media, state } = setup({ autoQueue: false });
		player.play(A);
		metadata(media(), 60);
		reach(media(), 60);
		pausedByBrowser(media());
		media().emit("ended");

		player.play(A);
		media().emit("play");

		expect(media().currentTime).toBe(0);
		expect(media().paused).toBe(false);
		expect(state().status).toBe("playing");
	});

	test("an external change to settings, progress or the queue leaves playback alone", () => {
		const { player, host, media, state, writes } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 40, 1000);
		const written = writes(A);

		host.settings.currentEpisode = C;
		saved(A, 999, 3600);
		queue.set({ ...get(queue), episodes: [C, A] });
		downloadedEpisodes.set({ Show: [{ ...A, filePath: "Downloads/A.mp3", size: 1 }] });

		expect(media().src).toBe(A.streamUrl);
		expect(media().currentTime).toBe(40);
		expect(media().paused).toBe(false);
		expect(state()).toMatchObject({ status: "playing", episode: A });
		expect(host.settings.currentEpisode).toBe(C);
		expect(queued()).toEqual(["C", "A"]);

		reach(media(), 46, 7000);
		expect(written.at(-1)).toEqual({ time: 46, finished: false, checkpoint: true });
	});
});

describe("legacy title-only progress (PB-06)", () => {
	function savedUnderTitle(ep: Episode, podcastName: string, time: number) {
		playedEpisodes.update((played) => ({
			...played,
			[ep.title]: { title: ep.title, podcastName, time, duration: 3600, finished: false },
		}));
	}

	const starts = [
		[
			"restore() then resume()",
			(player: PlayerController) => {
				player.restore(A);
				player.resume();
			},
		],
		["play()", (player: PlayerController) => void player.play(A)],
	] as const;

	test.each(starts)("another show's same-titled record is ignored by %s", (_, start) => {
		savedUnderTitle(A, "A Different Podcast", 1800);
		const { player, media, state } = setup();

		start(player);
		expect(state().currentTime).toBe(0);
		metadata(media());

		expect(media().currentTime).toBe(0);
	});

	test.each(starts)("a record without a podcast name resumes the episode by %s", (_, start) => {
		savedUnderTitle(A, "", 900);
		const { player, media, state } = setup();

		start(player);
		expect(state().currentTime).toBe(900);
		metadata(media());

		expect(media().currentTime).toBe(900);
	});

	test("the episode's own record wins over a title-only one", () => {
		savedUnderTitle(A, "", 900);
		saved(A, 1200, 3600);
		const { player, media } = setup();

		player.restore(A);
		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(1200);
	});
});

describe("deferPlay", () => {
	test("plays only when nothing newer happened", () => {
		const { player, state } = setup();
		const fresh = player.deferPlay();
		expect(fresh(A)).toBe(true);

		const stale = player.deferPlay();
		player.play(B);
		expect(stale(C)).toBe(false);

		const paused = player.deferPlay();
		player.pause();
		expect(paused(C)).toBe(false);

		expect(state().episode).toBe(B);
	});

	test.each([
		["resume()", (player: PlayerController) => player.resume()],
		["toggle()", (player: PlayerController) => player.toggle()],
		["seek()", (player: PlayerController) => void player.seek(30)],
		["pause()", (player: PlayerController) => player.pause()],
		["play()", (player: PlayerController) => void player.play(A)],
	])("a %s of the paused episode while it waits makes it stale", (_, intent) => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		player.pause();
		const link = player.deferPlay();

		intent(player);

		expect(link(B)).toBe(false);
		expect(state().episode).toBe(A);
		expect(media().src).toBe(A.streamUrl);
	});

	test("a resume() while it already plays makes it stale", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		const link = player.deferPlay();

		player.resume();

		expect(link(B)).toBe(false);
		expect(state().episode).toBe(A);
	});

	test("a play the browser starts, such as from a media key, makes it stale", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		player.pause();
		const link = player.deferPlay();

		media().paused = false;
		media().emit("play");

		expect(link(B)).toBe(false);
		expect(state()).toMatchObject({ status: "playing", episode: A });
	});

	test("a pause the browser makes, such as from a media key, makes it stale", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		const link = player.deferPlay();

		pausedByBrowser(media());

		expect(link(B)).toBe(false);
		expect(state()).toMatchObject({ status: "paused", episode: A });
	});

	test("a natural end with nothing queued leaves it to play", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media(), 60);
		const link = player.deferPlay();

		reach(media(), 60);
		media().ended = true;
		pausedByBrowser(media());
		media().emit("ended");

		expect(link(B)).toBe(true);
		expect(state().episode).toBe(B);
	});

	test("a queue advance makes it stale", () => {
		queue.set({ ...get(queue), episodes: [B] });
		const { player, media, state } = setup();
		player.play(A);
		metadata(media());
		const later = player.deferPlay();

		media().ended = true;
		pausedByBrowser(media());
		media().emit("ended");

		expect(later(C)).toBe(false);
		expect(state().episode).toBe(B);
	});

	test("the browser's pause after a segment stops leaves it to play", () => {
		const { player, media, state } = setup();
		player.play(A, { time: 100, endTime: 125 });
		metadata(media());
		const link = player.deferPlay();

		reach(media(), 126);
		expect(state().status).toBe("paused");
		media().emit("pause");

		expect(link(B)).toBe(true);
		expect(state().episode).toBe(B);
	});
});

describe("volume and rate", () => {
	const levels = (media: FakeMedia) => ({
		volume: media.volume,
		playbackRate: media.playbackRate,
		defaultPlaybackRate: media.defaultPlaybackRate,
	});

	test("volume is clamped and saved as the default volume", () => {
		const { player, host, media, state } = setup({ defaultVolume: 0.5 });

		player.setVolume(1.4);
		player.setVolume(Number.NaN);

		expect(media().volume).toBe(1);
		expect(state().volume).toBe(1);
		expect(host.settings.defaultVolume).toBe(1);
		expect(host.saveSettings).toHaveBeenCalledTimes(1);
	});

	test("a new episode starts at the default speed as it is now, at the player's volume", () => {
		const { player, host, media, state } = setup();
		host.settings.defaultVolume = 0.4;
		host.settings.defaultPlaybackRate = 1.8;

		player.play(A);
		metadata(media());

		expect(levels(media())).toEqual({
			volume: 1,
			playbackRate: 1.8,
			defaultPlaybackRate: 1.8,
		});
		expect(state()).toMatchObject({ volume: 1, playbackRate: 1.8 });
	});

	test("a live speed lasts for its episode, and the volume carries over to the next", () => {
		const { player, host, media, state } = setup({
			defaultVolume: 0.4,
			defaultPlaybackRate: 1.8,
		});
		player.play(A);
		metadata(media());

		player.setVolume(0.7);
		player.setPlaybackRate(1.3);
		player.pause();
		player.resume();
		player.play(A);
		expect(levels(media())).toEqual({
			volume: 0.7,
			playbackRate: 1.3,
			defaultPlaybackRate: 1.3,
		});

		player.play(B);
		metadata(media());
		expect(levels(media())).toEqual({
			volume: 0.7,
			playbackRate: 1.8,
			defaultPlaybackRate: 1.8,
		});
		expect(state()).toMatchObject({ volume: 0.7, playbackRate: 1.8 });
		expect(host.settings).toMatchObject({ defaultVolume: 0.7, defaultPlaybackRate: 1.8 });
	});

	test("a level set before the first play of a restored episode survives the load", () => {
		const { player, media, state } = setup({ defaultPlaybackRate: 1.8 });
		player.restore(A);
		player.setVolume(0.5);
		player.setPlaybackRate(2.3);

		player.resume();

		expect(levels(media())).toEqual({
			volume: 0.5,
			playbackRate: 2.3,
			defaultPlaybackRate: 2.3,
		});
		expect(state()).toMatchObject({ status: "loading", volume: 0.5, playbackRate: 2.3 });
	});

	test.each([
		[
			"resume() after an error",
			(player: PlayerController, media: () => FakeMedia) => {
				media().emit("error");
				player.resume();
			},
		],
		[
			"play() of its new media, such as a finished download,",
			(player: PlayerController) =>
				player.play({ ...A, streamUrl: "https://cdn.example.com/A-v2.mp3" }),
		],
	])("%s reloads the episode at its live levels", (_, reload) => {
		const { player, host, media, state } = setup();
		player.play(A);
		metadata(media());
		player.setVolume(0.7);
		player.setPlaybackRate(1.3);
		host.settings.defaultPlaybackRate = 1.8;

		reload(player, media);

		expect(state().status).toBe("loading");
		expect(levels(media())).toEqual({
			volume: 0.7,
			playbackRate: 1.3,
			defaultPlaybackRate: 1.3,
		});
	});

	test("the queue's next episode starts at the default speed and the live volume", () => {
		const { player, media } = setup({ defaultVolume: 0.4, defaultPlaybackRate: 1.8 });
		queue.set({ ...get(queue), episodes: [B] });
		player.play(A);
		metadata(media());
		player.setVolume(0.7);
		player.setPlaybackRate(1.3);

		media().emit("ended");

		expect(media().src).toBe(B.streamUrl);
		expect(levels(media())).toEqual({
			volume: 0.7,
			playbackRate: 1.8,
			defaultPlaybackRate: 1.8,
		});
	});

	test("a popout's reload of the video keeps the live levels", () => {
		const { player, doc, media } = setup({ defaultVolume: 0.4, defaultPlaybackRate: 1.8 });
		const stage = new FakeParent(doc);
		player.play(VIDEO);
		metadata(media());
		player.videoStage(stage as unknown as HTMLElement);
		player.setVolume(0.7);
		player.setPlaybackRate(1.3);

		stage.ownerDocument = {};
		media().load();
		media().emit("emptied");
		metadata(media());

		expect(levels(media())).toEqual({
			volume: 0.7,
			playbackRate: 1.3,
			defaultPlaybackRate: 1.3,
		});
	});

	test("a default speed out of range loads like it does at startup", () => {
		const { player, host, media } = setup();
		host.settings.defaultPlaybackRate = 9;

		player.play(A);

		expect(levels(media())).toEqual({ volume: 1, playbackRate: 4, defaultPlaybackRate: 4 });
	});
});

describe("errors", () => {
	test("resume() retries the load at the position it had", () => {
		saved(A, 500, 3600);
		const { player, media, state } = setup();
		player.play(A);
		media().emit("error");
		expect(state()).toMatchObject({ status: "error", currentTime: 500 });

		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(500);
		expect(state().status).toBe("playing");
	});

	test("resume() starts at the progress a sync brought, whatever the user moved before the load", () => {
		const { player, media } = setup();
		player.restore(A);
		player.seek(900);
		player.play(B);
		media().emit("error");

		saved(B, 300, 1800);
		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(300);
	});

	test.each([
		["on loaded media", true],
		["while it loads", false],
	])("resume() retries at a position the user sought %s", (_, loaded) => {
		saved(A, 600, 3600);
		const { player, media } = setup();
		player.play(A);
		if (loaded) metadata(media());
		player.seek(2000);
		media().emit("error");

		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(2000);
	});

	test.each([
		[
			"on the loaded episode",
			(player: PlayerController, media: () => FakeMedia) => {
				player.play(A);
				metadata(media());
				reach(media(), 610, 1000);
				return player.play(A, { time: 2000 });
			},
			2000,
		],
		[
			"on the restored episode",
			(player: PlayerController) => {
				player.restore(A);
				return player.play(A, { time: 2000 });
			},
			2000,
		],
		[
			"on another episode",
			(player: PlayerController, media: () => FakeMedia) => {
				player.play(A);
				metadata(media());
				return player.play(B, { time: 1500 });
			},
			1500,
		],
	])("resume() retries at a link's time %s after a media error", (_, link, time) => {
		saved(A, 600, 3600);
		saved(B, 300, 1800);
		const { player, media } = setup();
		expect(link(player, media)).toBe(true);
		media().emit("error");

		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(time);
	});

	test("a link's time on the loaded episode survives a retry that fails too", () => {
		saved(A, 600, 3600);
		const { player, media } = setup();
		player.play(A);
		metadata(media());
		reach(media(), 610, 1000);
		player.play(A, { time: 2000 });
		media().emit("error");
		player.resume();
		media().emit("error");

		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(2000);
	});

	test.each([
		["resume()", (player: PlayerController) => player.resume()],
		["play()", (player: PlayerController) => void player.play(A)],
	])("a position moved on the restored episode survives a failed first %s", (_, start) => {
		saved(A, 600, 3600);
		const { player, media, state } = setup();
		player.restore(A);
		player.seek(900);
		start(player);
		media().emit("error");
		expect(state()).toMatchObject({ status: "error", currentTime: 900 });

		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(900);
	});

	test("resume() starts at the progress a sync brought during an error, after an earlier seek was saved", () => {
		saved(A, 600, 3600);
		const { player, media } = setup();
		player.play(A);
		metadata(media());
		player.seek(630);
		reach(media(), 700, 10_000);
		reach(media(), 1800, 20_000);
		media().emit("error");

		saved(A, 3000, 3600);
		player.restore(A);
		player.resume();
		metadata(media());

		expect(media().currentTime).toBe(3000);
	});
});

describe("dispose", () => {
	test("saves the position, releases the element and ignores everything after", () => {
		const { player, doc, media, state, writes } = setup();
		const written = writes(A);
		player.play(A);
		metadata(media());
		reach(media(), 90, 1000);
		written.length = 0;

		player.dispose();
		const after = state();

		expect(written).toEqual([{ time: 90, finished: false, checkpoint: false }]);
		expect(media().paused).toBe(true);
		expect(doc.body.children).toEqual([]);
		expect(player.play(B)).toBe(false);
		expect(player.seek(10)).toBe(false);
		player.resume();
		media().emit("ended");
		expect(state()).toEqual(after);
	});
});

describe("dropped elements", () => {
	test("let go of their media when a video replaces the audio and on dispose", () => {
		const { player, doc } = setup();
		player.play(A);
		const audio = doc.media;
		metadata(audio);

		player.play(VIDEO);
		const video = doc.media;
		metadata(video);
		player.dispose();

		for (const dropped of [audio, video]) {
			expect(dropped.src).toBe("");
			expect(dropped.readyState).toBe(0);
			expect(dropped.paused).toBe(true);
		}
	});
});

describe("video stage", () => {
	test("shows the video in a stage in the main window and keeps it hidden elsewhere", () => {
		const { player, doc } = setup();
		const stage = new FakeParent(doc);
		player.play(VIDEO);
		const action = player.videoStage(stage as unknown as HTMLElement);

		expect(stage.children).toEqual([doc.media]);
		expect(doc.media.hidden).toBe(false);

		stage.migrateTo({});
		expect(doc.body.children).toEqual([doc.media]);
		expect(doc.media.hidden).toBe(true);

		stage.migrateTo(doc);
		expect(stage.children).toEqual([doc.media]);

		action.destroy();
		expect(doc.body.children).toEqual([doc.media]);
		expect(doc.media.hidden).toBe(true);
	});

	test("moves a video that loads later into a stage that is already shown", () => {
		const { player, doc } = setup();
		player.restore(VIDEO);
		const stage = new FakeParent(doc);
		player.videoStage(stage as unknown as HTMLElement);
		expect(stage.children).toEqual([]);

		player.resume();

		expect(stage.children).toEqual([doc.media]);
		expect(doc.media.tagName).toBe("VIDEO");
		expect(doc.media.attributes.has("playsinline")).toBe(true);
	});

	test("an older stage's teardown leaves the video in the newer stage", () => {
		const { player, doc } = setup();
		player.play(VIDEO);
		const older = player.videoStage(new FakeParent(doc) as unknown as HTMLElement);
		const newer = new FakeParent(doc);
		player.videoStage(newer as unknown as HTMLElement);

		older.destroy();

		expect(newer.children).toEqual([doc.media]);
	});

	test("a video carried to a popout reloads where it was and keeps playing in the main window", () => {
		const { player, doc, media, state, writes } = setup();
		const written = writes(VIDEO);
		const stage = new FakeParent(doc);
		player.play(VIDEO);
		metadata(media());
		player.videoStage(stage as unknown as HTMLElement);
		reach(media(), 40, 1000);
		written.length = 0;

		// The popout adopts the stage with the video in it, and the browser reloads the video.
		stage.ownerDocument = {};
		media().load();
		media().emit("emptied");
		media().emit("timeupdate");

		expect(written).toEqual([]);
		expect(state()).toMatchObject({ status: "loading", currentTime: 40 });
		expect(doc.body.children).toEqual([media()]);
		metadata(media());
		expect(media().currentTime).toBe(40);
		expect(media().paused).toBe(false);
		expect(state().status).toBe("playing");
	});

	test.each(["before", "after"])(
		"a reset that aborts a pending play (rejected %s the emptied event) plays on once the media is back",
		async (order) => {
			const { player, doc, media, state } = setup();
			const stage = new FakeParent(doc);
			player.play(VIDEO);
			metadata(media());
			player.videoStage(stage as unknown as HTMLElement);
			expect(media().plays).toHaveLength(1);

			stage.ownerDocument = {};
			media().load();
			if (order === "before") await flush();
			media().emit("emptied");
			await flush();
			metadata(media());

			expect(media().paused).toBe(false);
			expect(state().status).toBe("playing");
		},
	);

	/** VIDEO played to its end in a stage the popout then carried away, and the browser reloaded it. */
	function finishedThenReset(seekDuringPlay?: number) {
		const context = setup();
		const { player, doc, media } = context;
		const stage = new FakeParent(doc);
		player.play(VIDEO);
		metadata(media(), 60);
		player.videoStage(stage as unknown as HTMLElement);
		if (seekDuringPlay !== undefined) player.seek(seekDuringPlay);
		reach(media(), 60);
		pausedByBrowser(media());
		media().emit("ended");

		stage.ownerDocument = {};
		media().load();
		media().emit("emptied");
		metadata(media(), 60);
		return context;
	}

	test("a finished video that a reset reloads stays finished", () => {
		const { player, state } = finishedThenReset();

		player.save();
		player.play(B);

		expect(progress(VIDEO)).toMatchObject({ time: 60, duration: 60, finished: true });
		expect(queued()).toEqual([]);
		expect(state()).toMatchObject({ status: "loading", episode: B });
	});

	test("a finished video that a reset reloads lets go of its media", () => {
		const { media } = finishedThenReset();

		expect(media().src).toBe("");
	});

	test("resume() starts a finished video that a reset reloaded over", () => {
		const { player, media, state } = finishedThenReset();

		player.resume();
		metadata(media(), 60);

		expect(media().src).toBe(VIDEO.streamUrl);
		expect(media().currentTime).toBe(0);
		expect(media().paused).toBe(false);
		expect(state().status).toBe("playing");
	});

	test("resume() of a finished video that a reset reloaded keeps its live speed", () => {
		const { player, host, media, state } = finishedThenReset();
		player.setPlaybackRate(1.3);
		host.settings.defaultPlaybackRate = 1.8;

		player.resume();

		expect(state().status).toBe("loading");
		expect(media().playbackRate).toBe(1.3);
	});

	test("a finished video sought during play restarts at the beginning after a reset", () => {
		const { player, media, state } = finishedThenReset(30);

		player.resume();
		metadata(media(), 60);

		expect(media().currentTime).toBe(0);
		expect(media().paused).toBe(false);
		expect(state().status).toBe("playing");
	});

	test("a new rendition of a finished episode starts at the beginning", () => {
		const { player, media, state } = setup();
		player.play(A);
		metadata(media(), 60);
		reach(media(), 60);
		pausedByBrowser(media());
		media().emit("ended");
		expect(state().status).toBe("ended");

		player.play({ ...A, streamUrl: "https://cdn.example.com/A-reissued.mp3" });
		metadata(media(), 60);

		expect(media().src).toBe("https://cdn.example.com/A-reissued.mp3");
		expect(media().currentTime).toBe(0);
		expect(media().paused).toBe(false);
	});

	test("a seek in a finished video that a reset reloaded plays from there", () => {
		const { player, media, state } = finishedThenReset();

		player.seek(30);
		expect(state()).toMatchObject({ status: "paused", currentTime: 30 });
		player.resume();
		metadata(media(), 60);

		expect(media().currentTime).toBe(30);
		expect(media().paused).toBe(false);
	});

	test("a reset element saves no position until it holds media again", () => {
		const { player, media, state, writes } = setup();
		const written = writes(A);
		player.play(A);
		metadata(media());
		reach(media(), 40, 1000);
		written.length = 0;

		media().load();
		player.save();
		player.pause();
		media().emit("emptied");

		expect(written).toEqual([]);
		expect(state()).toMatchObject({ status: "paused", currentTime: 40 });
		metadata(media());
		expect(media().currentTime).toBe(40);
		expect(media().paused).toBe(true);
	});

	test("names the video after the episode it loads", () => {
		const { player, media } = setup();
		const next = episode("W", {
			streamUrl: "https://cdn.example.com/W.mp4",
			mediaType: "video",
		});

		player.play(VIDEO);
		expect(media().attributes.get("aria-label")).toBe("V");
		player.play(next);

		expect(media().tagName).toBe("VIDEO");
		expect(media().attributes.get("aria-label")).toBe("W");
	});

	test("keeps audio hidden in the main window", () => {
		const { player, doc } = setup();
		player.play(A);
		player.videoStage(new FakeParent(doc) as unknown as HTMLElement);

		expect(doc.body.children).toEqual([doc.media]);
		expect(doc.media.hidden).toBe(true);
		expect(doc.media.className).toBe("podnotes-media");
	});
});
