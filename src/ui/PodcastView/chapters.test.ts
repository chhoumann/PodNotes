import { describe, expect, test, vi } from "vitest";
import { fetchChapters } from "src/utility/fetchChapters";
import { cachedChapters, chapterAt, loadChapters, segmentsOf } from "./chapters";

vi.mock("src/utility/fetchChapters", () => ({ fetchChapters: vi.fn() }));

const chapters = [0, 60, 120].map((startTime) => ({ startTime, title: `At ${startTime}` }));

describe("chapters", () => {
	test("the chapter under way is the last one started", () => {
		expect([0, 59, 60, 500].map((time) => chapterAt(chapters, time))).toEqual([0, 0, 1, 2]);
		expect(chapterAt(chapters.slice(1), 30)).toBe(-1);
	});

	test("split the scrubber at each start inside the episode", () => {
		expect(segmentsOf(chapters, 180)).toEqual([
			[0, 60],
			[60, 120],
			[120, 180],
		]);
		expect(segmentsOf([...chapters, { startTime: 500, title: "Past the end" }], 180)).toEqual([
			[0, 60],
			[60, 120],
			[120, 180],
		]);
	});

	test("never make an empty or backward stretch from unsorted or repeated starts", () => {
		const messy = [120, 60, 60].map((startTime) => ({ startTime, title: "" }));

		expect(segmentsOf(messy, 180)).toEqual([
			[0, 60],
			[60, 120],
			[120, 180],
		]);
		expect(segmentsOf([], 0)).toEqual([[0, 0]]);
	});

	test("a load that failed, as offline, fetches again the next time", async () => {
		const url = "https://pod.test/chapters.json";
		vi.mocked(fetchChapters).mockResolvedValueOnce([]).mockResolvedValueOnce(chapters);

		expect(await loadChapters(url)).toEqual([]);
		expect(cachedChapters(url)).toBeUndefined();
		expect(await loadChapters(url)).toEqual(chapters);

		expect(fetchChapters).toHaveBeenCalledTimes(2);
		expect(cachedChapters(url)).toEqual(chapters);
		expect(cachedChapters("https://pod.test/other.json")).toBeUndefined();
	});

	test("each episode keeps the chapters it loaded, whichever load finishes first", async () => {
		const earlier = "https://pod.test/earlier.json";
		const latest = "https://pod.test/latest.json";
		let finishEarlier: (loaded: typeof chapters) => void = () => {};
		vi.mocked(fetchChapters)
			.mockReturnValueOnce(new Promise((resolve) => (finishEarlier = resolve)))
			.mockResolvedValueOnce(chapters);

		const slow = loadChapters(earlier);
		await loadChapters(latest);
		finishEarlier([{ startTime: 0, title: "Earlier" }]);
		await slow;

		expect(cachedChapters(latest)).toEqual(chapters);
		expect(cachedChapters(earlier)).toEqual([{ startTime: 0, title: "Earlier" }]);
	});
});
