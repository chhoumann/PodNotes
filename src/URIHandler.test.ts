import * as obsidian from "obsidian";
import { TFile, TFolder, type ObsidianProtocolData } from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import podNotesURIHandler from "./URIHandler";
import { API } from "./API/API";
import { DEFAULT_SETTINGS } from "./constants";
import { PlayerController } from "./player/PlayerController";
import { localFiles, playedEpisodes, plugin, queue, viewState } from "./store";
import type { Episode, EpisodeMediaType } from "./types/Episode";
import type { LocalEpisode } from "./types/LocalEpisode";
import type { Playlist } from "./types/Playlist";
import { ViewState } from "./types/ViewState";
import { FakeDocument } from "../tests/mocks/fakeMedia";
import { deferred } from "../tests/mocks/feeds";

const mockEpisodesAt = vi.fn();
const testFeedUrl = "https://pod.example.com/feed.xml";

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

let doc: FakeDocument;
let player: PlayerController;
let vaultFiles: string[] = [];
let vaultFolders: string[] = [];

const state = () => get(player.state);
const media = () => doc.media;

function link(params: Record<string, string>, revealPlayer?: () => void) {
	return podNotesURIHandler(
		{ action: "podnotes", url: testFeedUrl, episodeName: testEpisode.title, ...params },
		revealPlayer,
	);
}

/** Follows a Markdown link PodNotes wrote, as Obsidian decodes it: each value with decodeURIComponent. */
function follow(markdownLink: string) {
	const href = markdownLink.slice(markdownLink.indexOf("](") + 2, -1);
	const params: Record<string, string> = { action: "podnotes" };
	for (const pair of new URL(href).search.slice(1).split("&")) {
		const [key, value] = pair.split("=");
		params[key] = decodeURIComponent(value);
	}
	return podNotesURIHandler(params as ObsidianProtocolData);
}

/** A vault file as "Play with PodNotes" registers it. */
const clip = (folder: string, extension = "mp3", mediaType?: EpisodeMediaType): LocalEpisode => ({
	title: "Clip",
	streamUrl: `app://resource/${folder}/Clip.${extension}`,
	url: `[[${folder}/Clip.${extension}]]`,
	description: "",
	content: "",
	podcastName: "local file",
	filePath: `${folder}/Clip.${extension}`,
	mediaType,
});

function vaultFile(path: string): TFile {
	const name = path.split("/").pop() ?? path;
	return Object.assign(new TFile(), {
		path,
		name,
		extension: name.split(".").pop() ?? "",
		basename: name.replace(/\.[^.]+$/, ""),
		stat: { ctime: 0, mtime: 0, size: 1 },
	});
}

/** The media's metadata arrives, after which the player is at its start position. */
function metadata(duration = 3600) {
	media().duration = duration;
	media().emit("loadedmetadata");
}

/** `episode` is loaded and paused at `time`. */
function loadedAt(episode: Episode, time: number) {
	player.play(episode, { time });
	metadata();
	player.pause();
}

beforeEach(() => {
	vaultFiles = [];
	vaultFolders = [];
	doc = new FakeDocument();
	const host = {
		settings: structuredClone(DEFAULT_SETTINGS),
		app: {
			vault: {
				getAbstractFileByPath: vi.fn((path: string) => {
					if (vaultFiles.includes(path)) return vaultFile(path);
					if (vaultFolders.includes(path)) return Object.assign(new TFolder(), { path });
					return null;
				}),
				getResourcePath: (file: TFile) => `app://resource/${file.path}`,
				getFiles: () => vaultFiles.map(vaultFile),
			},
			fileManager: { generateMarkdownLink: (file: TFile) => `[[${file.path}]]` },
		},
		checkpoint: (update: () => void) => update(),
		saveSettings: vi.fn(() => Promise.resolve()),
	};
	player = new PlayerController(doc.asPlayerDocument(), host as never);
	const feeds = {
		episodesAt: mockEpisodesAt,
		load: () => Promise.resolve(),
		subscribe: (run: (feeds: Map<string, unknown>) => void) => (run(new Map()), () => {}),
	};
	plugin.set({ ...host, player, feeds } as never);
	playedEpisodes.set({});
	queue.set({ ...structuredClone(DEFAULT_SETTINGS.queue), episodes: [] });
	viewState.set(ViewState.PodcastGrid);
	localFiles.set({ ...emptyLocalFiles, episodes: [] });
	mockEpisodesAt.mockResolvedValue([testEpisode]);
});

afterEach(() => {
	mockEpisodesAt.mockReset();
	plugin.set(undefined as never);
});

describe("podNotesURIHandler", () => {
	test("seeks and plays the linked episode when it is already loaded", async () => {
		loadedAt(testEpisode, 3000);

		await link({ time: "120" });

		expect(get(viewState)).toBe(ViewState.Player);
		expect(media().currentTime).toBe(120);
		expect(media().paused).toBe(false);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("plays a not-loaded episode at the requested time once its metadata loads", async () => {
		playedEpisodes.markAsPlayed(testEpisode);
		const revealPlayer = vi.fn();

		await link({ time: "240" }, revealPlayer);

		expect(mockEpisodesAt).toHaveBeenCalledWith(testFeedUrl);
		expect(state()).toMatchObject({ status: "loading", episode: { title: testEpisode.title } });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(revealPlayer).toHaveBeenCalledTimes(1);
		metadata();
		expect(media().currentTime).toBe(240);
		expect(
			get(playedEpisodes)[`${testEpisode.podcastName}::${testEpisode.title}`]?.finished,
		).toBe(true);
	});

	test.each(["not-a-number", "12abc", " "])(
		"does not play or reveal the player for the timestamp %j",
		async (time) => {
			const revealPlayer = vi.fn();

			await link({ time }, revealPlayer);

			expect(revealPlayer).not.toHaveBeenCalled();
			expect(state().episode).toBeUndefined();
			expect(get(viewState)).toBe(ViewState.PodcastGrid);
			expect(mockEpisodesAt).not.toHaveBeenCalled();
		},
	);

	test.each([
		"http://169.254.169.254/latest/meta-data/",
		"http://127.0.0.1:8080/feed.xml",
		"http://192.168.0.1/feed.xml",
	])(
		"refuses a deep link whose url points at an internal host (%s) without fetching",
		async (url) => {
			const revealPlayer = vi.fn();

			await link({ url, episodeName: "Some Episode" }, revealPlayer);

			// The attacker-controlled url is never handed to the feed parser.
			expect(mockEpisodesAt).not.toHaveBeenCalled();
			expect(state().episode).toBeUndefined();
			expect(get(viewState)).toBe(ViewState.PodcastGrid);
			expect(revealPlayer).not.toHaveBeenCalled();
		},
	);

	test("plays a not-loaded episode's segment and stops at its end", async () => {
		await link({ time: "240", endTime: "260" });
		metadata();

		expect(media().currentTime).toBe(240);
		media().currentTime = 261;
		media().emit("timeupdate");
		expect(media().currentTime).toBe(260);
		expect(media().paused).toBe(true);
	});

	test("plays a segment of the already-loaded episode", async () => {
		loadedAt(testEpisode, 3000);

		await link({ time: "120", endTime: "135" });
		media().currentTime = 136;
		media().emit("timeupdate");

		expect(media().currentTime).toBe(135);
		expect(media().paused).toBe(true);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("a plain timestamp link ends a running segment", async () => {
		player.play(testEpisode, { time: 10, endTime: 20 });
		metadata();

		await link({ time: "120" });
		media().currentTime = 130;
		media().emit("timeupdate");

		expect(media().currentTime).toBe(130);
		expect(media().paused).toBe(false);
	});

	test("switches to a non-loaded episode whose title contains a literal '+'", async () => {
		mockEpisodesAt.mockResolvedValue([plusEpisode]);

		// Current-format link: Obsidian decodes %2B back to a literal '+'.
		await link({ episodeName: "Episode 50: C++ Tips", time: "300" });
		metadata();

		expect(state().episode).toMatchObject({ title: "Episode 50: C++ Tips" });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(media().currentTime).toBe(300);
	});

	test("resumes a paused, already-loaded episode whose title contains a literal '+'", async () => {
		loadedAt(plusEpisode, 10);

		await link({ episodeName: "Episode 50: C++ Tips", time: "90" });

		expect(media().currentTime).toBe(90);
		expect(media().paused).toBe(false);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("resolves a legacy '+'-as-space link to a non-loaded episode", async () => {
		// Legacy link: spaces were encoded as '+'.
		await link({ episodeName: "Finished+Episode", time: "60" });
		metadata();

		expect(state().episode).toMatchObject({ title: "Finished Episode" });
		expect(media().currentTime).toBe(60);
	});

	test("resumes the loaded episode for a legacy '+'-as-space link without re-resolving", async () => {
		loadedAt(testEpisode, 10);

		await link({ episodeName: "Finished+Episode", time: "45" });

		expect(media().currentTime).toBe(45);
		expect(media().paused).toBe(false);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
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
		vaultFiles = ["Notes+/C++ Tips.mp3"];

		await link({ url: "Notes+/C++ Tips.mp3", episodeName: "C++ Tips", time: "30" });
		metadata();

		expect(state().episode).toMatchObject({ title: "C++ Tips" });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(media().src).toBe("app://resource/Notes+/C++ Tips.mp3");
		expect(media().currentTime).toBe(30);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("plays a moved local file from where it is now instead of routing to the feed parser (LF-08)", async () => {
		const localEpisode: LocalEpisode = {
			title: "Local Note",
			streamUrl: "app://resource/Old/Local Note.mp3",
			url: "[[Old/Local Note.mp3]]",
			description: "",
			content: "",
			podcastName: "local file",
			filePath: "Old/Local Note.mp3",
		};
		localFiles.set({ ...emptyLocalFiles, episodes: [localEpisode] });
		// The file was moved: the recorded path no longer resolves to a file, and
		// the url has no http(s) scheme, so it must be treated as a vault path.
		vaultFiles = ["New/Local Note.mp3"];

		await link({ url: "Old/Local Note.mp3", episodeName: "Local Note", time: "15" });
		metadata();

		expect(state().episode).toMatchObject({
			title: "Local Note",
			filePath: "New/Local Note.mp3",
		});
		expect(media().src).toBe("app://resource/New/Local Note.mp3");
		expect(media().currentTime).toBe(15);
		expect(get(viewState)).toBe(ViewState.Player);
		// A schemeless path must never hit the feed parser.
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("resolves a feed episode after the publisher rearranges the title (#315)", async () => {
		const currentTitle =
			"Access Your Best Self With Mind-Body Practices, Belief Testing & Imagination | Dr. Martha Beck";
		const hubermanEpisode: Episode = {
			...testEpisode,
			title: currentTitle,
			url: "https://pod.example.com/martha",
			streamUrl: "https://pod.example.com/martha.mp3",
			podcastName: "Huberman Lab",
		};
		mockEpisodesAt.mockResolvedValue([hubermanEpisode, testEpisode]);

		await link({
			episodeName:
				"Dr. Martha Beck: Access Your Best Self With Mind-Body Practices, Belief Testing & Imagination",
			time: "2580",
		});
		metadata();

		expect(state().episode).toMatchObject({ title: currentTitle });
		expect(media().currentTime).toBe(2580);
	});

	test("seeks the already-loaded episode when a timestamp uses the old title (#315)", async () => {
		const currentTitle =
			"Access Your Best Self With Mind-Body Practices, Belief Testing & Imagination | Dr. Martha Beck";
		loadedAt({ ...testEpisode, title: currentTitle, podcastName: "Huberman Lab" }, 10);

		await link({
			episodeName:
				"Dr. Martha Beck: Access Your Best Self With Mind-Body Practices, Belief Testing & Imagination",
			time: "90",
		});

		expect(media().currentTime).toBe(90);
		expect(media().paused).toBe(false);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("does not seek a loaded Part 2 when the link is for Part 1 (#315)", async () => {
		const part1: Episode = {
			...testEpisode,
			title: "The History of Rome: The Fall of the Republic, Part 1",
			url: "https://pod.example.com/part1",
			streamUrl: "https://pod.example.com/part1.mp3",
			podcastName: "The History of Rome",
		};
		const part2: Episode = {
			...part1,
			title: "The History of Rome: The Fall of the Republic, Part 2",
			url: "https://pod.example.com/part2",
			streamUrl: "https://pod.example.com/part2.mp3",
		};
		loadedAt(part2, 10);
		mockEpisodesAt.mockResolvedValue([part1, part2]);

		await link({ episodeName: part1.title, time: "90" });
		metadata();

		expect(mockEpisodesAt).toHaveBeenCalledWith(testFeedUrl);
		expect(state().episode).toMatchObject({ title: part1.title });
		expect(media().src).toBe(part1.streamUrl);
		expect(media().currentTime).toBe(90);
	});

	test("does not take a same-titled episode of another show for the loaded one", async () => {
		const trailerA: Episode = { ...testEpisode, title: "Trailer", podcastName: "Show A" };
		const trailerB: Episode = {
			...trailerA,
			podcastName: "Show B",
			feedUrl: "https://b.example.com/feed.xml",
			streamUrl: "https://b.example.com/trailer.mp3",
		};
		loadedAt(trailerA, 10);
		mockEpisodesAt.mockResolvedValue([trailerB]);

		await link({ url: "https://b.example.com/feed.xml", episodeName: "Trailer", time: "5" });

		expect(mockEpisodesAt).toHaveBeenCalledWith("https://b.example.com/feed.xml");
		expect(state().episode).toMatchObject({ podcastName: "Show B" });
		expect(media().src).toBe(trailerB.streamUrl);
	});

	test("does not play a feed episode that arrives after the user played another", async () => {
		let resolveFeed!: (episodes: Episode[]) => void;
		mockEpisodesAt.mockReturnValue(
			new Promise<Episode[]>((resolve) => {
				resolveFeed = resolve;
			}),
		);
		const revealPlayer = vi.fn();
		const other: Episode = { ...plusEpisode, title: "Other" };

		const pending = link({ time: "240" }, revealPlayer);
		player.play(other);
		resolveFeed([testEpisode]);
		await pending;

		expect(state().episode).toBe(other);
		expect(media().src).toBe(other.streamUrl);
		expect(revealPlayer).not.toHaveBeenCalled();
	});

	test("does not pick a leftover similar episode when the linked title is gone (#315)", async () => {
		mockEpisodesAt.mockResolvedValue([{ ...testEpisode, title: "Weekly News Roundup Extra" }]);

		await link({ episodeName: "Weekly News Roundup", time: "10" });

		expect(state().episode).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
	});

	test("does not treat a weakly similar feed title as a match (#315)", async () => {
		mockEpisodesAt.mockResolvedValue([
			{ ...testEpisode, title: "Optimize Testosterone & Estrogen | Dr. Kyle Gillett" },
		]);

		await link({
			episodeName:
				"Dr. Martha Beck: Access Your Best Self With Mind-Body Practices, Belief Testing & Imagination",
			time: "10",
		});

		expect(state().episode).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
	});

	test("shows a notice and changes nothing when the episode cannot be found", async () => {
		mockEpisodesAt.mockResolvedValue([]);

		await expect(
			link({ episodeName: "Nonexistent Episode", time: "10" }),
		).resolves.toBeUndefined();

		expect(state().episode).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
	});

	test("a link whose feed loads after a newer link's changes nothing", async () => {
		const older = deferred<Episode[]>();
		const newer = deferred<Episode[]>();
		mockEpisodesAt.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

		const opening = [
			link({ episodeName: testEpisode.title, time: "5" }),
			link({ episodeName: plusEpisode.title, time: "5" }),
		];
		newer.resolve([testEpisode, plusEpisode]);
		older.resolve([testEpisode, plusEpisode]);
		await Promise.all(opening);

		expect(state().episode).toMatchObject({ title: plusEpisode.title });
		expect(media().src).toBe(plusEpisode.streamUrl);
	});

	test("a link whose feed fails after a newer link's shows no notice", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const older = deferred<Episode[]>();
		mockEpisodesAt.mockReturnValueOnce(older.promise).mockResolvedValueOnce([plusEpisode]);

		const opening = link({ episodeName: testEpisode.title, time: "5" });
		await link({ episodeName: plusEpisode.title, time: "5" });
		older.reject(new Error("offline"));
		await opening;

		expect(notice).not.toHaveBeenCalled();
		expect(state().episode).toMatchObject({ title: plusEpisode.title });
		notice.mockRestore();
	});

	test.each([
		[
			"fails",
			(older: ReturnType<typeof deferred<Episode[]>>) => older.reject(new Error("offline")),
		],
		["lacks the title", (older: ReturnType<typeof deferred<Episode[]>>) => older.resolve([])],
	])(
		"a link whose feed %s after a newer link to the loaded episode shows no notice",
		async (_, settle) => {
			const notice = vi.spyOn(obsidian, "Notice");
			vi.spyOn(console, "error").mockImplementation(() => {});
			loadedAt(plusEpisode, 30);
			const older = deferred<Episode[]>();
			mockEpisodesAt.mockReturnValueOnce(older.promise);

			const opening = link({ episodeName: testEpisode.title, time: "5" });
			await link({ episodeName: plusEpisode.title, time: "15" });
			settle(older);
			await opening;

			expect(notice).not.toHaveBeenCalled();
			expect(state().episode).toMatchObject({ title: plusEpisode.title });
			expect(media().currentTime).toBe(15);
			vi.restoreAllMocks();
		},
	);

	test("a link whose feed fails after a newer link to a local file shows no notice", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		const local = clip("A");
		localFiles.set({ ...emptyLocalFiles, episodes: [local] });
		vaultFiles = [local.filePath ?? ""];
		const older = deferred<Episode[]>();
		mockEpisodesAt.mockReturnValueOnce(older.promise);

		const opening = link({ episodeName: testEpisode.title, time: "5" });
		await link({ url: local.filePath ?? "", episodeName: local.title, time: "15" });
		older.reject(new Error("offline"));
		await opening;

		expect(notice).not.toHaveBeenCalled();
		expect(state().episode).toMatchObject({ filePath: local.filePath });
		vi.restoreAllMocks();
	});

	test("does not reject when feed parsing throws (no silent unhandled rejection)", async () => {
		mockEpisodesAt.mockRejectedValue(new Error("network down"));

		await expect(link({ episodeName: "Anything", time: "10" })).resolves.toBeUndefined();

		expect(state().episode).toBeUndefined();
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
		mockEpisodesAt.mockResolvedValue([spaceVariant, plusVariant]);

		await link({ episodeName: "A+B", time: "75" });
		metadata();

		expect(state().episode).toMatchObject({ title: "A+B" });
		expect(media().currentTime).toBe(75);
	});

	test("reopens a non-loaded episode without a timestamp and resumes from the saved location (#35)", async () => {
		playedEpisodes.setEpisodeTime(testEpisode, 321, 3600, false);

		// No `time`: the {{episodelink}} template tag omits it.
		await link({});
		metadata();

		expect(mockEpisodesAt).toHaveBeenCalledWith(testFeedUrl);
		expect(state().episode).toMatchObject({ title: testEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);
		expect(media().currentTime).toBe(321);
	});

	test("restarts a finished episode from the beginning for a no-timestamp link (#35)", async () => {
		// A finished episode is stored at its end; resuming there would auto-advance.
		playedEpisodes.setEpisodeTime(testEpisode, 3600, 3600, true);

		await link({});
		metadata();

		expect(state().episode).toMatchObject({ title: testEpisode.title });
		expect(media().currentTime).toBe(0);
	});

	test("restarts an already-loaded finished episode from the beginning for a no-timestamp link (#35)", async () => {
		player.play(testEpisode);
		metadata(180);
		media().currentTime = 180;
		media().paused = true;
		media().emit("pause");
		media().emit("ended");

		await link({});

		expect(get(viewState)).toBe(ViewState.Player);
		expect(media().currentTime).toBe(0);
		expect(media().paused).toBe(false);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("surfaces the player and resumes the already-loaded episode without seeking when no timestamp is given (#35)", async () => {
		loadedAt(testEpisode, 1234);

		await link({});

		expect(get(viewState)).toBe(ViewState.Player);
		// The live position is already the last played location: left untouched.
		expect(media().currentTime).toBe(1234);
		expect(media().paused).toBe(false);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("treats an empty timestamp the same as an omitted one (resume, not error) (#35)", async () => {
		await link({ time: "" });
		metadata();

		expect(state().episode).toMatchObject({ title: testEpisode.title });
		expect(get(viewState)).toBe(ViewState.Player);
		// No saved progress for this episode: resume from the start.
		expect(media().currentTime).toBe(0);
	});

	test.each([
		["a segment end without a start timestamp", { endTime: "20" }],
		["a segment end at the start timestamp", { time: "20", endTime: "20" }],
		["a segment end with trailing text", { time: "10", endTime: "20s" }],
		["a negative plain timestamp", { time: "-10" }],
		["a negative segment start timestamp", { time: "-10", endTime: "5" }],
	])("rejects %s", async (_, params) => {
		await link(params);

		expect(state().episode).toBeUndefined();
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
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
		vaultFiles = ["A+B.mp3"];

		await link({ url: "A+B.mp3", episodeName: "A+B", time: "20" });
		metadata();

		expect(state().episode).toMatchObject({ title: "A+B" });
		expect(media().currentTime).toBe(20);
	});
});

describe("a timestamp link PodNotes wrote for the loaded episode", () => {
	test("seeks a feed episode without fetching its feed", async () => {
		loadedAt(testEpisode, 754);
		const written = new API().getPodcastTimeFormatted("HH:mm:ss", true);
		player.seek(10);

		await follow(written);

		expect(media().currentTime).toBe(754);
		expect(media().src).toBe(testEpisode.streamUrl);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("seeks a local file without fetching a feed", async () => {
		vaultFiles = ["A/Clip.mp3"];
		loadedAt(clip("A"), 15);
		const written = new API().getPodcastTimeFormatted("HH:mm:ss", true);
		player.seek(40);

		await follow(written);

		expect(media().currentTime).toBe(15);
		expect(media().src).toBe("app://resource/A/Clip.mp3");
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("plays the file it names, as that file, after a same-named file in another folder replaced it", async () => {
		vaultFiles = ["A/Clip.mov", "B/Clip.mp3"];
		loadedAt(clip("A", "mov", "video"), 15);
		const written = new API().getPodcastTimeFormatted("HH:mm:ss", true);
		const registered = clip("B", "mp3", "audio");
		localFiles.set({ ...emptyLocalFiles, episodes: [registered] });
		loadedAt(registered, 40);

		await follow(written);
		metadata();

		expect(state().episode).toMatchObject({
			title: "Clip",
			filePath: "A/Clip.mov",
			url: "[[A/Clip.mov]]",
			streamUrl: "app://resource/A/Clip.mov",
		});
		expect(state().mediaType).toBe("video");
		expect(media().tagName).toBe("VIDEO");
		expect(media().src).toBe("app://resource/A/Clip.mov");
		expect(media().currentTime).toBe(15);
	});
});

describe("a link that carries the episode's guid", () => {
	const retitled: Episode = {
		...testEpisode,
		title: "Season finale: what we learned",
		guid: "ep-1",
	};
	const trailer: Episode = {
		...testEpisode,
		title: "Trailer",
		streamUrl: "https://pod.example.com/trailer.mp3",
	};

	test("plays the feed episode with that guid after the publisher retitled it and reused its title", async () => {
		loadedAt({ ...testEpisode, guid: "ep-1" }, 754);
		const written = new API().getPodcastTimeFormatted("HH:mm:ss", true);
		loadedAt(plusEpisode, 10);
		mockEpisodesAt.mockResolvedValue([
			{ ...trailer, title: testEpisode.title, guid: "ep-2" },
			retitled,
		]);

		await follow(written);
		metadata();

		expect(state().episode).toMatchObject({ title: retitled.title, guid: "ep-1" });
		expect(media().currentTime).toBe(754);
	});

	test("falls back to the title when two feed episodes share the guid", async () => {
		mockEpisodesAt.mockResolvedValue([
			{ ...trailer, guid: "ep-1" },
			{ ...testEpisode, guid: "ep-1" },
		]);

		await link({ guid: "ep-1", time: "30" });

		expect(state().episode).toMatchObject({ title: testEpisode.title });
	});

	test("falls back to the title when no feed episode has the guid", async () => {
		mockEpisodesAt.mockResolvedValue([trailer, { ...testEpisode, guid: "ep-1" }]);

		await link({ guid: "ep-2", time: "30" });

		expect(state().episode).toMatchObject({ title: testEpisode.title });
	});

	test("a link without a guid plays the titled episode, not the one feed episode without a guid", async () => {
		mockEpisodesAt.mockResolvedValue([trailer, { ...testEpisode, guid: "ep-1" }]);

		await link({ time: "30" });

		expect(state().episode).toMatchObject({ title: testEpisode.title });
	});

	test("resumes the loaded episode by its guid after it was retitled", async () => {
		loadedAt(retitled, 10);
		mockEpisodesAt.mockResolvedValue([trailer, retitled]);

		await link({ guid: "ep-1", time: "90" });

		expect(mockEpisodesAt).toHaveBeenCalledWith(testFeedUrl);
		expect(state().episode).toMatchObject({ title: retitled.title, guid: "ep-1" });
		expect(media().currentTime).toBe(90);
		expect(media().paused).toBe(false);
	});

	test("plays the feed episode with the link's guid, not a loaded same-titled episode with another guid", async () => {
		const linked: Episode = { ...retitled, streamUrl: "https://pod.example.com/finale.mp3" };
		loadedAt({ ...testEpisode, guid: "ep-2" }, 10);
		mockEpisodesAt.mockResolvedValue([{ ...testEpisode, guid: "ep-2" }, linked]);

		await link({ guid: "ep-1", time: "30" });
		metadata();

		expect(mockEpisodesAt).toHaveBeenCalledWith(testFeedUrl);
		expect(state().episode).toMatchObject({ title: linked.title, guid: "ep-1" });
		expect(media().src).toBe(linked.streamUrl);
		expect(media().currentTime).toBe(30);
	});

	test("plays the feed episode with the link's guid, not a loaded same-titled episode without a guid", async () => {
		const linked: Episode = { ...retitled, streamUrl: "https://pod.example.com/finale.mp3" };
		loadedAt(testEpisode, 10);
		mockEpisodesAt.mockResolvedValue([
			{ ...trailer, title: testEpisode.title, guid: "ep-2" },
			linked,
		]);

		await link({ guid: "ep-1", time: "30" });
		metadata();

		expect(mockEpisodesAt).toHaveBeenCalledWith(testFeedUrl);
		expect(state().episode).toMatchObject({ title: linked.title, guid: "ep-1" });
		expect(media().src).toBe(linked.streamUrl);
		expect(media().currentTime).toBe(30);
	});

	test("plays the titled episode, not the loaded one, when both share the link's guid", async () => {
		const loadedTwin: Episode = { ...trailer, guid: "ep-1" };
		const named: Episode = { ...testEpisode, guid: "ep-1" };
		loadedAt(loadedTwin, 10);
		mockEpisodesAt.mockResolvedValue([loadedTwin, named]);

		await link({ guid: "ep-1", time: "30" });
		metadata();

		expect(state().episode).toMatchObject({ title: named.title });
		expect(media().src).toBe(named.streamUrl);
		expect(media().currentTime).toBe(30);
	});

	test("does not take the loaded episode of another feed for one with the same guid", async () => {
		const otherFeed = "https://other.example.com/feed.xml";
		const other: Episode = {
			...testEpisode,
			title: "Other show's episode",
			streamUrl: "https://other.example.com/1.mp3",
			feedUrl: otherFeed,
			guid: "ep-1",
		};
		loadedAt(retitled, 10);
		mockEpisodesAt.mockResolvedValue([other]);

		await link({ url: otherFeed, episodeName: "Something else", guid: "ep-1", time: "5" });

		expect(mockEpisodesAt).toHaveBeenCalledWith(otherFeed);
		expect(media().src).toBe(other.streamUrl);
	});
});

describe("a link to a vault file at its path", () => {
	test("plays the file at the link's time when it is not in Local Files", async () => {
		vaultFiles = ["Fixtures/Orphan.mp3"];

		await link({ url: "Fixtures/Orphan.mp3", episodeName: "Orphan", time: "12" });
		metadata();

		expect(state().episode).toMatchObject({
			title: "Orphan",
			podcastName: "local file",
			filePath: "Fixtures/Orphan.mp3",
		});
		expect(get(viewState)).toBe(ViewState.Player);
		expect(media().src).toBe("app://resource/Fixtures/Orphan.mp3");
		expect(media().currentTime).toBe(12);
		expect(media().paused).toBe(false);
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("plays an .mp4 registered as video at that path as video", async () => {
		localFiles.set({ ...emptyLocalFiles, episodes: [clip("A", "mp4", "video")] });
		vaultFiles = ["A/Clip.mp4"];

		await link({ url: "A/Clip.mp4", episodeName: "Clip", time: "12" });
		metadata();

		expect(state().mediaType).toBe("video");
		expect(media().tagName).toBe("VIDEO");
		expect(media().src).toBe("app://resource/A/Clip.mp4");
		expect(media().currentTime).toBe(12);
	});

	test("plays the file as it is registered at that path under another name", async () => {
		const intro: LocalEpisode = { ...clip("A", "mp4", "video"), title: "Intro" };
		localFiles.set({ ...emptyLocalFiles, episodes: [intro] });
		vaultFiles = ["A/Clip.mp4"];

		await link({ url: "A/Clip.mp4", episodeName: "Clip", time: "12" });
		metadata();

		expect(state().episode).toEqual(intro);
		expect(state().mediaType).toBe("video");
		expect(media().tagName).toBe("VIDEO");
		expect(media().src).toBe("app://resource/A/Clip.mp4");
		expect(media().currentTime).toBe(12);
	});
});

describe("a link to a vault file that is no longer at its path", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	test("plays the one vault file with that name, even when another file is registered for it", async () => {
		localFiles.set({ ...emptyLocalFiles, episodes: [clip("B")] });
		vaultFiles = ["C/Clip.mp3"];

		await link({ url: "A/Clip.mp3", episodeName: "Clip", time: "12" });
		metadata();

		expect(media().src).toBe("app://resource/C/Clip.mp3");
		expect(media().currentTime).toBe(12);
	});

	test("shows a notice and plays nothing when several vault files have that name", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		localFiles.set({ ...emptyLocalFiles, episodes: [clip("B")] });
		vaultFiles = ["B/Clip.mp3", "C/Clip.mp3"];

		await link({ url: "A/Clip.mp3", episodeName: "Clip", time: "12" });

		expect(notice).toHaveBeenCalledWith(
			'More than one vault file is named "Clip.mp3". Update the link with the correct path.',
		);
		expect(state().episode).toBeUndefined();
		expect(media().src).toBe("");
		expect(get(viewState)).toBe(ViewState.PodcastGrid);
	});

	test("shows a notice and plays nothing when no vault file has that name", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		localFiles.set({ ...emptyLocalFiles, episodes: [clip("A")] });
		vaultFiles = ["B/Other.mp3"];

		await link({ url: "A/Clip.mp3", episodeName: "Clip", time: "12" });

		expect(notice).toHaveBeenCalledWith('No vault file is named "Clip.mp3".');
		expect(state().episode).toBeUndefined();
		expect(media().src).toBe("");
		expect(mockEpisodesAt).not.toHaveBeenCalled();
	});

	test("counts files named like the link's literal '+' before its legacy '+'-as-space form", async () => {
		vaultFiles = ["New/A+B.mp3", "Other/A B.mp3"];

		await link({ url: "Old/A+B.mp3", episodeName: "A+B", time: "20" });
		metadata();

		expect(media().src).toBe("app://resource/New/A+B.mp3");
	});

	test("does not fall back to the legacy '+'-as-space form when the literal name is ambiguous", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vaultFiles = ["X/A+B.mp3", "Y/A+B.mp3", "Z/A B.mp3"];

		await link({ url: "Old/A+B.mp3", episodeName: "A+B", time: "20" });

		expect(notice).toHaveBeenCalledWith(
			'More than one vault file is named "A+B.mp3". Update the link with the correct path.',
		);
		expect(media().src).toBe("");
	});

	test("plays the loaded local file from where it moved to", async () => {
		vaultFiles = ["A/Clip.mp3"];
		loadedAt(clip("A"), 15);
		vaultFiles = ["C/Clip.mp3"];

		await link({ url: "A/Clip.mp3", episodeName: "Clip", time: "30" });
		metadata();

		expect(media().src).toBe("app://resource/C/Clip.mp3");
		expect(media().currentTime).toBe(30);
	});

	test("plays the loaded local file from where it moved to when a folder took its path", async () => {
		vaultFiles = ["A/Clip.mp3"];
		loadedAt(clip("A"), 15);
		vaultFiles = ["C/Clip.mp3"];
		vaultFolders = ["A/Clip.mp3"];

		await link({ url: "A/Clip.mp3", episodeName: "Clip", time: "30" });
		metadata();

		expect(media().src).toBe("app://resource/C/Clip.mp3");
		expect(media().currentTime).toBe(30);
	});

	test("plays the file at the link's legacy '+'-as-space path, not the loaded '+' file that moved away", async () => {
		const plusClip: LocalEpisode = {
			title: "Clip+One",
			streamUrl: "app://resource/A/Clip+One.mp3",
			url: "[[A/Clip+One.mp3]]",
			description: "",
			content: "",
			podcastName: "local file",
			filePath: "A/Clip+One.mp3",
		};
		localFiles.set({ ...emptyLocalFiles, episodes: [plusClip] });
		vaultFiles = ["A/Clip+One.mp3", "A/Clip One.mp3"];
		loadedAt(plusClip, 15);
		vaultFiles = ["C/Clip+One.mp3", "A/Clip One.mp3"];

		await link({ url: "A/Clip+One.mp3", episodeName: "Clip+One", time: "30" });
		metadata();

		expect(media().src).toBe("app://resource/A/Clip One.mp3");
		expect(media().currentTime).toBe(30);
	});

	test.each(["mp4", "webm"])(
		"plays a moved .%s registered as video as video",
		async (extension) => {
			localFiles.set({ ...emptyLocalFiles, episodes: [clip("A", extension, "video")] });
			vaultFiles = [`B/Clip.${extension}`];

			await link({ url: `A/Clip.${extension}`, episodeName: "Clip", time: "12" });
			metadata();

			expect(state().mediaType).toBe("video");
			expect(media().tagName).toBe("VIDEO");
			expect(media().src).toBe(`app://resource/B/Clip.${extension}`);
			expect(media().currentTime).toBe(12);
		},
	);

	test.each(["mp4", "webm"])(
		"plays a loaded .%s video from where it moved to as video",
		async (extension) => {
			vaultFiles = [`A/Clip.${extension}`];
			loadedAt(clip("A", extension, "video"), 15);
			vaultFiles = [`B/Clip.${extension}`];

			await link({ url: `A/Clip.${extension}`, episodeName: "Clip", time: "30" });
			metadata();

			expect(state().mediaType).toBe("video");
			expect(media().tagName).toBe("VIDEO");
			expect(media().src).toBe(`app://resource/B/Clip.${extension}`);
			expect(media().currentTime).toBe(30);
		},
	);

	test("plays the moved file as it is registered at its new path", async () => {
		localFiles.set({
			...emptyLocalFiles,
			episodes: [clip("A", "mp4", "video"), clip("B", "mp4", "audio")],
		});
		vaultFiles = ["B/Clip.mp4"];

		await link({ url: "A/Clip.mp4", episodeName: "Clip", time: "12" });
		metadata();

		expect(state().mediaType).toBe("audio");
		expect(media().tagName).toBe("AUDIO");
		expect(media().src).toBe("app://resource/B/Clip.mp4");
	});

	test("does not take a media type from a same-titled file registered at another path", async () => {
		localFiles.set({ ...emptyLocalFiles, episodes: [clip("X", "mp4", "video")] });
		vaultFiles = ["B/Clip.mp4"];

		await link({ url: "A/Clip.mp4", episodeName: "Clip", time: "12" });
		metadata();

		expect(state().mediaType).toBe("audio");
		expect(media().tagName).toBe("AUDIO");
		expect(media().src).toBe("app://resource/B/Clip.mp4");
	});

	test.each(["mp4", "webm"])(
		"plays a moved .%s registered as video as video from a legacy link with '+' for its folder's space",
		async (extension) => {
			localFiles.set({
				...emptyLocalFiles,
				episodes: [clip("Old Folder", extension, "video")],
			});
			vaultFiles = [`New/Clip.${extension}`];

			await link({ url: `Old+Folder/Clip.${extension}`, episodeName: "Clip", time: "12" });
			metadata();

			expect(state().mediaType).toBe("video");
			expect(media().tagName).toBe("VIDEO");
			expect(media().src).toBe(`app://resource/New/Clip.${extension}`);
			expect(media().currentTime).toBe(12);
		},
	);

	test.each(["mp4", "webm"])(
		"plays a loaded .%s video from where it moved to as video from a legacy link with '+' for its folder's space",
		async (extension) => {
			vaultFiles = [`Old Folder/Clip.${extension}`];
			loadedAt(clip("Old Folder", extension, "video"), 15);
			vaultFiles = [`New/Clip.${extension}`];

			await link({ url: `Old+Folder/Clip.${extension}`, episodeName: "Clip", time: "30" });
			metadata();

			expect(state().mediaType).toBe("video");
			expect(media().tagName).toBe("VIDEO");
			expect(media().src).toBe(`app://resource/New/Clip.${extension}`);
			expect(media().currentTime).toBe(30);
		},
	);

	test("does not take a media type from a file registered at the link's legacy path when that file has another name", async () => {
		const legacyNamed: LocalEpisode = {
			title: "A B",
			streamUrl: "app://resource/Old Folder/A B.mp4",
			url: "[[Old Folder/A B.mp4]]",
			description: "",
			content: "",
			podcastName: "local file",
			filePath: "Old Folder/A B.mp4",
			mediaType: "video",
		};
		localFiles.set({ ...emptyLocalFiles, episodes: [legacyNamed] });
		vaultFiles = ["New/A+B.mp4"];

		await link({ url: "Old+Folder/A+B.mp4", episodeName: "A+B", time: "12" });
		metadata();

		expect(state().mediaType).toBe("audio");
		expect(media().tagName).toBe("AUDIO");
		expect(media().src).toBe("app://resource/New/A+B.mp4");
		expect(media().currentTime).toBe(12);
	});
});

describe("links that arrive while another link loads its feed", () => {
	test("a link refused before its fetch leaves the earlier one to play", async () => {
		let resolveFeed!: (episodes: Episode[]) => void;
		mockEpisodesAt.mockReturnValue(
			new Promise<Episode[]>((resolve) => {
				resolveFeed = resolve;
			}),
		);

		const pending = link({ time: "240" });
		await link({ url: "http://localhost/feed.xml", time: "5" });
		await link({ url: "podnotes-private-feed:Unknown%20Feed", time: "5" });
		await link({ url: "Notes/moved.mp3", episodeName: "Nothing by this name", time: "5" });
		resolveFeed([testEpisode]);
		await pending;

		expect(state().episode).toMatchObject({ title: testEpisode.title });
		expect(media().src).toBe(testEpisode.streamUrl);
	});
});
