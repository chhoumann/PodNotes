import { describe, expect, test } from "vitest";
import type { Episode } from "src/types/Episode";
import { episodeRowModel, formatMinutes, rowKeys, type RowState } from "./episodeRow";

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
	available: true,
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
		expect(row({ cover: true }).meta).toEqual(["48 min"]);
	});

	test("says a Played record whose episode left every feed is unavailable", () => {
		expect(row({ available: false })).toMatchObject({
			unavailable: true,
			label: "#214 Reading slowly, unavailable",
		});
	});

	test("shows nothing it does not know", () => {
		const bare = { ...episode, episodeDate: undefined, duration: undefined };
		expect(row({}, bare).meta).toEqual([]);
		expect(row({}, { ...bare, episodeDate: "not a date" as never }).meta).toEqual([]);
	});
});

test("minutes round to whole minutes, at least one, and hours past 60", () => {
	expect([20, 90, 48 * 60, 63 * 60].map(formatMinutes)).toEqual([
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
