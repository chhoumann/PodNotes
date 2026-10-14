import { describe, expect, test } from "vitest";
import type { PlayerStatus } from "src/player/PlayerController";
import type { Episode } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import {
	availabilityOf,
	episodeRowModel,
	formatMinutes,
	isPlaying,
	rowKeys,
	secondsLeft,
	totalSeconds,
	type RowState,
} from "./episodeRow";

const thisYear = new Date().getFullYear();
const episode: Episode = {
	title: "#214 Reading slowly",
	streamUrl: "https://media.test/214.mp3",
	url: "https://show.test/214",
	description: "",
	content: "",
	podcastName: "Field Notes",
	episodeDate: new Date(thisYear, 9, 9),
	duration: 48 * 60,
};
const state: RowState = {
	played: {},
	downloads: {},
	now: undefined,
	playing: false,
	hasNote: false,
	cover: false,
	date: true,
	availability: "available",
};
const record = (time: number, duration: number, finished = false) => ({
	"Field Notes::#214 Reading slowly": {
		title: episode.title,
		podcastName: episode.podcastName,
		time,
		duration,
		finished,
	},
});
const row = (changes: Partial<RowState> = {}, of: Episode = episode) =>
	episodeRowModel(of, { ...state, ...changes });

test("counts a loading episode as playing, and no other status", () => {
	const playing: Record<PlayerStatus, boolean> = {
		empty: false,
		restored: false,
		loading: true,
		playing: true,
		paused: false,
		ended: false,
		error: false,
	};

	for (const [status, expected] of Object.entries(playing))
		expect(isPlaying(status as PlayerStatus), status).toBe(expected);
});

describe("an episode row", () => {
	test("shows the date and the duration of an episode not yet played", () => {
		expect(row()).toMatchObject({
			meta: ["Oct 9", "48 min"],
			played: false,
			current: false,
			label: "#214 Reading slowly",
		});
		expect(row().progress).toBeUndefined();
	});

	test("names the year of an episode from another year", () => {
		expect(row({}, { ...episode, episodeDate: new Date(2019, 0, 2) }).meta).toEqual([
			"Jan 2, 2019",
			"48 min",
		]);
	});

	test("shows a played episode as played, with its duration", () => {
		expect(row({ played: record(2880, 2880, true) })).toMatchObject({
			meta: ["Oct 9", "48 min"],
			played: true,
			label: "#214 Reading slowly, played",
		});
	});

	test("shows an episode in progress with the time left and how far it got", () => {
		const model = row({ played: record(14 * 60, 48 * 60) });
		expect(model.meta).toEqual(["Oct 9", "34 min left"]);
		expect(model.progress).toBeCloseTo(14 / 48);
		expect(model.label).toBe("#214 Reading slowly, 34 min left");
	});

	test("shows the current episode as playing or paused instead of its date", () => {
		const now = { ...episode, description: "another copy" };
		expect(row({ now, playing: true })).toMatchObject({
			meta: ["Playing", "48 min"],
			current: true,
			playing: true,
			label: "#214 Reading slowly, playing",
		});
		expect(row({ now, playing: false })).toMatchObject({
			meta: ["Paused", "48 min"],
			playing: false,
			label: "#214 Reading slowly, paused",
		});
	});

	test("is not current for a same-titled episode of another podcast", () => {
		expect(row({ now: { ...episode, podcastName: "Other" }, playing: true }).current).toBe(
			false,
		);
	});

	test("says it is downloaded and has a note", () => {
		const downloads = { "Field Notes": [{ ...episode, filePath: "a.mp3", size: 1 }] };
		expect(row({ downloads, hasNote: true })).toMatchObject({
			downloaded: true,
			hasNote: true,
			label: "#214 Reading slowly, downloaded, has note",
		});
	});

	test("never calls a local file downloaded, and shows no date for it", () => {
		const local = { ...episode, podcastName: "local file" };
		const downloads = { "local file": [{ ...local, filePath: "a.mp3", size: 1 }] };
		expect(row({ downloads }, local)).toMatchObject({ downloaded: false, meta: ["48 min"] });
	});

	test("names the podcast instead of the date when it has a cover", () => {
		expect(row({ cover: true, date: false })).toMatchObject({
			source: "Field Notes",
			meta: ["48 min"],
		});
		expect(row().source).toBeUndefined();
	});

	test("on Latest, names the podcast and the date, but not the date of one under way", () => {
		expect(row({ cover: true })).toMatchObject({
			source: "Field Notes",
			meta: ["Oct 9", "48 min"],
		});
		expect(row({ cover: true, played: record(14 * 60, 48 * 60) }).meta).toEqual([
			"34 min left",
		]);
	});

	test("names no podcast for the current episode, which says it is playing", () => {
		expect(row({ cover: true, now: episode, playing: true })).toMatchObject({
			source: undefined,
			meta: ["Playing", "48 min"],
		});
	});

	test("says a Played record whose episode left every feed is unavailable", () => {
		expect(row({ availability: "missing" })).toMatchObject({
			unavailable: true,
			label: "#214 Reading slowly, unavailable",
		});
	});

	test("says an episode offline with no copy is not downloaded", () => {
		expect(row({ availability: "not-downloaded" })).toMatchObject({
			unavailable: true,
			label: "#214 Reading slowly, not downloaded",
		});
	});

	test("takes the length from the Played record when the feed gives none", () => {
		const bare = { ...episode, duration: undefined };
		expect(row({ played: record(2880, 2880, true) }, bare).meta).toEqual(["Oct 9", "48 min"]);
	});

	test("shows nothing it does not know", () => {
		const bare = { ...episode, episodeDate: undefined, duration: undefined };
		expect(row({}, bare).meta).toEqual([]);
		expect(row({}, { ...bare, episodeDate: "not a date" as never }).meta).toEqual([]);
	});
});

test("under a minute shows seconds, at least one, then whole minutes, and hours past 60", () => {
	expect([0.2, 20, 59.4, 59.6, 90, 48 * 60, 63 * 60].map(formatMinutes)).toEqual([
		"1 s",
		"20 s",
		"59 s",
		"1 min",
		"2 min",
		"48 min",
		"1 h 3 min",
	]);
});

describe("row keys", () => {
	const rerun = (streamUrl: string) => ({ episode: { ...episode, title: "Rerun", streamUrl } });

	test("keep every episode, also two that share a podcast and a title", () => {
		const keys = rowKeys([rerun("1.mp3"), rerun("2.mp3")]).map(([key]) => key);
		expect(new Set(keys).size).toBe(2);
	});
});

describe("a vault file's row", () => {
	const file: LocalEpisode = {
		title: "Interview with grandma.m4a",
		streamUrl: "app://vault/Recordings/Family/Interview with grandma.m4a",
		url: "",
		description: "",
		content: "",
		podcastName: "local file",
		filePath: "Recordings/Family/Interview with grandma.m4a",
	};
	const played = {
		"local file::Interview with grandma.m4a": {
			title: file.title,
			podcastName: "local file",
			time: 0,
			duration: 64 * 60,
			finished: true,
		},
	};

	test("shows a file tile and its folder, and the length it learned when it played", () => {
		expect(row({ cover: true, played }, file)).toMatchObject({
			tile: "music",
			source: "Recordings/Family",
			meta: ["1 h 4 min"],
			played: true,
		});
	});

	test("names the vault's root for a file at the root, and shows a video tile for a video", () => {
		const video = { ...file, filePath: "Lecture.mp4", mediaType: "video" } as const;
		expect(row({ cover: true }, video)).toMatchObject({ tile: "video", source: "/" });
	});

	test("shows no tile or folder without a cover", () => {
		expect(row({}, file)).toMatchObject({ tile: undefined, source: undefined });
	});
});

describe("list times", () => {
	const second = { ...episode, title: "#215 Margins", duration: 30 * 60 };
	const under = (time: number) => ({
		...record(time, 48 * 60),
		"Field Notes::#215 Margins": {
			title: second.title,
			podcastName: "Field Notes",
			time: 30 * 60,
			duration: 30 * 60,
			finished: true,
		},
	});

	test("total each episode's length", () => {
		expect(totalSeconds([episode, second], under(14 * 60))).toBe(78 * 60);
	});

	test("count what is left of one under way, and all of a finished one, which plays again", () => {
		expect(secondsLeft([episode, second], under(14 * 60))).toBe(34 * 60 + 30 * 60);
	});

	test("count an episode of unknown length as nothing", () => {
		expect(secondsLeft([{ ...episode, duration: undefined }], {})).toBe(0);
	});
});

describe("availability", () => {
	const downloads = { "Field Notes": [{ ...episode, filePath: "Downloads/214.mp3", size: 1 }] };
	const other = { ...episode, title: "#215 Margins", streamUrl: "https://media.test/215.mp3" };

	test("online, every episode found in a feed plays", () => {
		expect(availabilityOf(other, true, true, {})).toBe("available");
	});

	test("offline, an episode plays from its vault file or a downloaded copy, and no other", () => {
		expect(availabilityOf(episode, true, false, downloads)).toBe("available");
		expect(availabilityOf({ ...other, filePath: "a.mp3" } as Episode, true, false, {})).toBe(
			"available",
		);
		expect(availabilityOf(other, true, false, downloads)).toBe("not-downloaded");
	});

	test("a Played record no loaded feed lists is missing online, and offline needs a connection", () => {
		expect(availabilityOf(episode, false, true, downloads)).toBe("missing");
		expect(availabilityOf(episode, false, false, downloads)).toBe("not-downloaded");
	});
});
