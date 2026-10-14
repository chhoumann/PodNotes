import type { Vault } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { API } from "src/API/API";
import { DEFAULT_SETTINGS } from "src/constants";
import { downloadedEpisodes, playedEpisodes, plugin, queue } from "src/store";
import type { Chapter } from "src/types/Chapter";
import type { Episode } from "src/types/Episode";
import { getEpisodeKey } from "src/utility/episodeKey";
import { FakeDocument, type FakeMedia } from "../../tests/mocks/fakeMedia";
import { bindMediaSession, chapterStart } from "./mediaSession";
import { PlayerController } from "./PlayerController";

const A: Episode = {
	title: "A",
	podcastName: "Show",
	streamUrl: "https://cdn.example.com/A.mp3",
	url: "",
	description: "",
	content: "",
	artworkUrl: "https://cdn.example.com/show.jpg",
};

const ACTIONS = [
	"play",
	"pause",
	"seekbackward",
	"seekforward",
	"previoustrack",
	"nexttrack",
	"seekto",
];

class FakeMetadata {
	static built = 0;
	readonly title: string;
	readonly artist: string;
	readonly album: string;
	readonly artwork: Array<{ src: string }>;

	constructor({ title = "", artist = "", album = "", artwork = [] }: MediaMetadataInit = {}) {
		for (const { src } of artwork) new URL(src, "app://obsidian.md/");
		FakeMetadata.built++;
		this.title = title;
		this.artist = artist;
		this.album = album;
		this.artwork = artwork.map(({ src }) => ({ src }));
	}
}

class FakeMediaSession {
	readonly handlers = new Map<string, MediaSessionActionHandler>();
	metadata: FakeMetadata | null = null;
	playbackState: MediaSessionPlaybackState = "none";
	position: MediaPositionState | null = null;

	constructor(private readonly unsupported: string[] = []) {}

	setActionHandler(action: string, handler: MediaSessionActionHandler | null): void {
		if (this.unsupported.includes(action)) throw new TypeError(`"${action}" is not supported`);
		if (handler) this.handlers.set(action, handler);
		else this.handlers.delete(action);
	}

	setPositionState(state?: MediaPositionState): void {
		if (!state) {
			this.position = null;
			return;
		}
		const { duration = Number.NaN, position = 0, playbackRate = 1 } = state;
		if (!(duration >= 0) || position < 0 || position > duration || playbackRate === 0) {
			throw new TypeError("invalid position state");
		}
		this.position = state;
	}

	act(action: string, details: Partial<MediaSessionActionDetails> = {}): void {
		const handler = this.handlers.get(action);
		if (!handler) throw new Error(`no "${action}" handler`);
		handler({ action: action as MediaSessionAction, ...details });
	}
}

function setup({
	mediaSession = new FakeMediaSession() as FakeMediaSession | null,
	Metadata = FakeMetadata as typeof FakeMetadata | null,
	chapters = (_url: string): Promise<Chapter[]> => Promise.resolve([]),
} = {}) {
	const doc = new FakeDocument();
	const host = {
		settings: structuredClone(DEFAULT_SETTINGS),
		app: { vault: { getAbstractFileByPath: () => null } as unknown as Vault },
		checkpoint: (update: () => void) => update(),
		saveSettings: vi.fn(() => Promise.resolve()),
	};
	const player = new PlayerController(doc.asPlayerDocument(), host);
	plugin.set({ ...host, player } as never);
	const api = new API();
	const capture = vi.fn();
	const unbind = bindMediaSession(player, {
		mediaSession: (mediaSession ?? undefined) as unknown as MediaSession | undefined,
		MediaMetadata: (Metadata ?? undefined) as unknown as typeof MediaMetadata | undefined,
		settings: () => host.settings,
		captureTimestamp: capture,
		skipBackward: () => api.skipBackward(),
		skipForward: () => api.skipForward(),
		chapters,
	});
	unbinds.push(unbind);
	return {
		session: mediaSession as FakeMediaSession,
		host,
		player,
		capture,
		unbind,
		media: () => doc.media,
		state: () => get(player.state),
	};
}

function playing(context: ReturnType<typeof setup>, time: number, duration = 3600, episode = A) {
	context.player.play(episode);
	loaded(context.media(), duration);
	reach(context.media(), time);
}

function loaded(media: FakeMedia, duration: number) {
	media.duration = duration;
	media.emit("loadedmetadata");
}

function reach(media: FakeMedia, time: number) {
	media.currentTime = time;
	media.emit("timeupdate");
}

const unbinds: Array<() => void> = [];

beforeEach(() => {
	FakeMetadata.built = 0;
	playedEpisodes.set({});
	downloadedEpisodes.set({});
	queue.set({ ...structuredClone(DEFAULT_SETTINGS.queue), episodes: [] });
});

afterEach(() => {
	for (const unbind of unbinds.splice(0)) unbind();
	vi.restoreAllMocks();
});

describe("what the lock screen shows", () => {
	test("the playing episode, its podcast and artwork, and where it is", () => {
		const context = setup();

		playing(context, 40);

		expect(context.session.metadata).toEqual({
			title: "A",
			artist: "Show",
			album: "PodNotes",
			artwork: [{ src: A.artworkUrl }],
		});
		expect(context.session.playbackState).toBe("playing");
		expect(context.session.position).toEqual({ duration: 3600, playbackRate: 1, position: 40 });
	});

	test("the position follows the speed, and a pause", () => {
		const context = setup();
		playing(context, 40);

		context.player.setPlaybackRate(1.5);
		context.player.pause();

		expect(context.session.playbackState).toBe("paused");
		expect(context.session.position).toEqual({
			duration: 3600,
			playbackRate: 1.5,
			position: 40,
		});
	});

	test("a position past a stale length is clamped to it, and an unknown length shows none", () => {
		const context = setup();
		playedEpisodes.set({
			[getEpisodeKey(A)]: {
				title: "A",
				podcastName: "Show",
				time: 500,
				duration: 300,
				finished: false,
			},
		});

		context.player.play(A, { time: 500 });
		expect(context.session.position).toEqual({ duration: 300, playbackRate: 1, position: 300 });

		loaded(context.media(), Number.POSITIVE_INFINITY);
		reach(context.media(), 20);
		expect(context.session.playbackState).toBe("playing");
		expect(context.session.position).toBeNull();
	});

	test("a renamed episode shows its new title, without rebuilding the metadata as it plays", () => {
		const context = setup();
		context.player.restore(A);
		context.player.restore({ ...A, title: "A, renamed" });
		expect(context.session.metadata?.title).toBe("A, renamed");
		const built = FakeMetadata.built;

		playing(context, 40, 3600, { ...A, title: "A, renamed" });
		reach(context.media(), 41);
		reach(context.media(), 42);

		expect(FakeMetadata.built).toBe(built);
	});

	test("an artwork URL MediaMetadata rejects leaves the title and podcast", () => {
		const context = setup();

		context.player.restore({ ...A, artworkUrl: "https://[broken" });

		expect(context.session.metadata).toEqual({
			title: "A",
			artist: "Show",
			album: "PodNotes",
			artwork: [],
		});
	});
});

describe("actions", () => {
	test("play resumes the shown episode and pause pauses it", () => {
		const context = setup();
		context.player.restore(A);

		context.session.act("play");
		expect(context.state().status).toBe("loading");
		expect(context.media().src).toBe(A.streamUrl);

		context.session.act("pause");
		expect(context.state().status).toBe("paused");
	});

	test("seekto moves to the browser's time and ignores a missing or negative one", () => {
		const context = setup();
		playing(context, 40);

		context.session.act("seekto", { seekTime: 100 });
		context.session.act("seekto", {});
		context.session.act("seekto", { seekTime: -5 });

		expect(context.media().currentTime).toBe(100);
	});

	test("seekbackward and seekforward skip by the saved lengths, not the browser's offset", () => {
		const context = setup();
		playing(context, 100);
		context.host.settings.skipBackwardLength = 10;
		context.host.settings.skipForwardLength = 25;

		context.session.act("seekbackward", { seekOffset: 99 });
		expect(context.media().currentTime).toBe(90);

		context.session.act("seekforward", { seekOffset: 99 });
		expect(context.media().currentTime).toBe(115);
	});

	test("nexttrack skips forward by the skip length, stopping short of the end and never going back", () => {
		const context = setup();
		context.host.settings.skipForwardLength = 30;
		playing(context, 100, 200);

		context.session.act("nexttrack");
		expect(context.media().currentTime).toBe(130);

		reach(context.media(), 190);
		context.session.act("nexttrack");
		expect(context.media().currentTime).toBe(199.75);
		expect(context.state().status).toBe("playing");

		reach(context.media(), 199.9);
		context.session.act("nexttrack");
		expect(context.media().currentTime).toBe(199.9);
	});

	test("nexttrack skips the whole skip length while the episode's length is unknown", () => {
		const context = setup();
		context.host.settings.skipForwardLength = 30;
		context.player.play(A, { time: 10 });

		context.session.act("nexttrack");

		expect(context.state().currentTime).toBe(40);
	});

	test("previoustrack captures a timestamp, even before the episode plays", () => {
		const context = setup();
		context.player.restore(A);

		context.session.act("previoustrack");

		expect(context.capture).toHaveBeenCalledTimes(1);
	});
});

const B: Episode = { ...A, title: "B", streamUrl: "https://cdn.example.com/B.mp3" };
const C: Episode = { ...A, title: "C", streamUrl: "https://cdn.example.com/C.mp3" };
const WITH_CHAPTERS: Episode = { ...A, chaptersUrl: "https://cdn.example.com/A.json" };
const chapter = (startTime: number): Chapter => ({ startTime, title: `At ${startTime}` });
const CHAPTERS = [chapter(0), chapter(60), chapter(120)];
const titles = () => get(queue).episodes.map(({ title }) => title);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("headset mapping", () => {
	test("the default next track is forward by the skip length, previous track a capture", () => {
		const context = setup();
		playing(context, 100);

		context.session.act("nexttrack");
		context.session.act("previoustrack");

		expect(context.media().currentTime).toBe(115);
		expect(context.capture).toHaveBeenCalledTimes(1);
	});

	test("a mapping changed after binding applies at the next press", () => {
		const context = setup();
		playing(context, 100);

		context.host.settings.headsetPreviousTrack = "skipBackward";
		context.host.settings.headsetNextTrack = "captureTimestamp";
		context.session.act("previoustrack");
		context.session.act("nexttrack");

		expect(context.media().currentTime).toBe(85);
		expect(context.capture).toHaveBeenCalledTimes(1);
	});

	describe("Next in queue", () => {
		test("goes through the queue, queueing each episode switched away from last", () => {
			const context = setup();
			context.host.settings.headsetNextTrack = "nextInQueue";
			playing(context, 40);
			queue.add(B);
			queue.add(C);

			context.session.act("nexttrack");
			expect([context.state().episode?.title, titles()]).toEqual(["B", ["C", "A"]]);

			context.session.act("nexttrack");
			expect([context.state().episode?.title, titles()]).toEqual(["C", ["A", "B"]]);
		});

		test("with auto-queue off, plays the queue in order and queues nothing", () => {
			const context = setup();
			context.host.settings.headsetNextTrack = "nextInQueue";
			context.host.settings.autoQueue = false;
			playing(context, 40);
			queue.add(B);
			queue.add(C);

			context.session.act("nexttrack");
			context.session.act("nexttrack");

			expect([context.state().episode?.title, titles()]).toEqual(["C", []]);
		});

		test("does nothing with an empty queue, or when the player cannot play", () => {
			const context = setup();
			context.host.settings.headsetNextTrack = "nextInQueue";
			playing(context, 40);

			context.session.act("nexttrack");
			expect([context.state().episode?.title, context.state().currentTime]).toEqual([
				"A",
				40,
			]);

			queue.add(B);
			vi.spyOn(context.player, "play").mockReturnValue(false);
			context.session.act("nexttrack");
			expect([context.state().episode?.title, titles()]).toEqual(["A", ["B"]]);
		});
	});

	describe("chapters", () => {
		test("next and previous chapter seek to the episode's chapter starts", async () => {
			const chapters = vi.fn(() => Promise.resolve(CHAPTERS));
			const context = setup({ chapters });
			context.host.settings.headsetPreviousTrack = "previousChapter";
			context.host.settings.headsetNextTrack = "nextChapter";
			playing(context, 30, 3600, WITH_CHAPTERS);

			context.session.act("nexttrack");
			await flush();
			expect(context.media().currentTime).toBe(60);

			reach(context.media(), 61);
			context.session.act("previoustrack");
			await flush();
			expect(context.media().currentTime).toBe(0);

			reach(context.media(), 63);
			context.session.act("previoustrack");
			await flush();
			expect(context.media().currentTime).toBe(60);

			reach(context.media(), 130);
			context.session.act("nexttrack");
			await flush();
			expect(context.media().currentTime).toBe(130);
			expect(chapters.mock.calls).toEqual([[WITH_CHAPTERS.chaptersUrl]]);
		});

		test("chapters that arrive after the episode changed move nothing", async () => {
			let resolve!: (chapters: Chapter[]) => void;
			const context = setup({ chapters: () => new Promise((done) => (resolve = done)) });
			context.host.settings.headsetNextTrack = "nextChapter";
			playing(context, 30, 3600, WITH_CHAPTERS);

			context.session.act("nexttrack");
			playing(context, 10, 3600, B);
			resolve(CHAPTERS);
			await flush();

			expect([context.state().episode?.title, context.media().currentTime]).toEqual([
				"B",
				10,
			]);
		});

		test("no chapters loaded is a no-op the next press retries, and no chapters URL never asks", async () => {
			const chapters = vi
				.fn<(url: string) => Promise<Chapter[]>>()
				.mockRejectedValueOnce(new Error("offline"))
				.mockResolvedValueOnce([])
				.mockResolvedValue(CHAPTERS);
			const context = setup({ chapters });
			context.host.settings.headsetNextTrack = "nextChapter";
			playing(context, 30, 3600, WITH_CHAPTERS);

			for (const expected of [30, 30, 60]) {
				context.session.act("nexttrack");
				await flush();
				expect(context.media().currentTime).toBe(expected);
			}

			playing(context, 30, 3600, B);
			context.session.act("nexttrack");
			await flush();
			expect(chapters).toHaveBeenCalledTimes(3);
			expect(context.media().currentTime).toBe(30);
		});

		test("chapters that arrive after unbinding move nothing", async () => {
			let resolve!: (chapters: Chapter[]) => void;
			const context = setup({ chapters: () => new Promise((done) => (resolve = done)) });
			context.host.settings.headsetNextTrack = "nextChapter";
			playing(context, 30, 3600, WITH_CHAPTERS);

			context.session.act("nexttrack");
			context.unbind();
			resolve(CHAPTERS);
			await flush();

			expect(context.media().currentTime).toBe(30);
		});
	});

	test.each([
		[1, 0, 60],
		[1, 59.8, 120],
		[1, 59.7, 60],
		[1, 120, undefined],
		[-1, 61.9, 0],
		[-1, 62, 60],
		[-1, 1, 0],
	] as const)("chapterStart(%i) from %f s is %s", (direction, time, expected) => {
		expect(chapterStart(CHAPTERS, time, direction)).toBe(expected);
	});
});

describe("lifetime", () => {
	test("with nothing shown, the session is empty", () => {
		const context = setup();

		expect(context.session.handlers.size).toBe(0);
		expect(context.session.metadata).toBeNull();
		expect(context.session.playbackState).toBe("none");
		expect(context.session.position).toBeNull();
	});

	test("a restored episode has its actions and metadata, but no playback or position", () => {
		const context = setup();
		playedEpisodes.set({
			[getEpisodeKey(A)]: {
				title: "A",
				podcastName: "Show",
				time: 1234,
				duration: 3600,
				finished: false,
			},
		});

		context.player.restore(A);

		expect([...context.session.handlers.keys()].sort()).toEqual([...ACTIONS].sort());
		expect(context.session.metadata?.title).toBe("A");
		expect(context.session.playbackState).toBe("none");
		expect(context.session.position).toBeNull();
	});

	test("an episode that failed to load shows no playback or position, and play retries it", () => {
		const context = setup();
		playing(context, 40);

		context.media().emit("error");
		expect(context.session.playbackState).toBe("none");
		expect(context.session.position).toBeNull();

		context.session.act("play");
		expect(context.state().status).toBe("loading");
	});

	test("unbinding clears the session, and its old handlers do nothing", () => {
		const context = setup();
		playing(context, 40);
		context.player.pause();
		const handlers = new Map(context.session.handlers);
		const setActionHandler = vi.spyOn(context.session, "setActionHandler");

		context.unbind();
		context.unbind();
		for (const [action, handler] of handlers) {
			handler({ action: action as MediaSessionAction, seekTime: 5 });
		}
		context.player.play({ ...A, title: "B", streamUrl: "https://cdn.example.com/B.mp3" });

		expect(context.session.handlers.size).toBe(0);
		expect(setActionHandler).toHaveBeenCalledTimes(ACTIONS.length);
		expect(context.session.metadata).toBeNull();
		expect(context.session.playbackState).toBe("none");
		expect(context.session.position).toBeNull();
		expect(context.capture).not.toHaveBeenCalled();
		expect(context.state()).toMatchObject({ status: "loading", currentTime: 0 });
	});
});

describe("partial browser support", () => {
	test("an action the browser rejects leaves the others, and is not retried as it plays", () => {
		const session = new FakeMediaSession(["nexttrack", "seekto"]);
		const setActionHandler = vi.spyOn(session, "setActionHandler");
		const context = setup({ mediaSession: session });

		playing(context, 40);
		reach(context.media(), 41);

		expect([...session.handlers.keys()].sort()).toEqual(
			ACTIONS.filter((a) => a !== "nexttrack" && a !== "seekto").sort(),
		);
		expect(setActionHandler).toHaveBeenCalledTimes(ACTIONS.length);
	});

	test("without MediaMetadata, the actions and the position still work", () => {
		const context = setup({ Metadata: null });

		playing(context, 40);

		expect(context.session.handlers.size).toBe(ACTIONS.length);
		expect(context.session.metadata).toBeNull();
		expect(context.session.position).toEqual({ duration: 3600, playbackRate: 1, position: 40 });
	});

	test("browser calls that throw never reach the player", () => {
		const session = new FakeMediaSession();
		const fail = () => {
			throw new TypeError("not supported");
		};
		session.setPositionState = fail;
		Object.defineProperty(session, "playbackState", { set: fail });
		Object.defineProperty(session, "metadata", { set: fail });
		const context = setup({ mediaSession: session });
		const seen: string[] = [];
		const unsubscribe = context.player.state.subscribe(({ status }) => seen.push(status));

		playing(context, 40);
		unsubscribe();

		expect(session.handlers.size).toBe(ACTIONS.length);
		expect(seen).toContain("playing");
		expect(context.state()).toMatchObject({ status: "playing", currentTime: 40 });
	});

	test("without a Media Session, playback is unaffected", () => {
		const context = setup({ mediaSession: null });

		playing(context, 40);
		context.unbind();

		expect(context.state()).toMatchObject({ status: "playing", currentTime: 40 });
	});
});
