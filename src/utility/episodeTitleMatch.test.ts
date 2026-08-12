import { describe, expect, it } from "vitest";
import { findUniqueTitleMatch, titleTokenSimilarity, titleTokens } from "./episodeTitleMatch";

describe("episodeTitleMatch", () => {
	it("treats punctuation and word order as irrelevant", () => {
		const current =
			"Access Your Best Self With Mind-Body Practices, Belief Testing & Imagination | Dr. Martha Beck";
		const legacy =
			"Dr. Martha Beck: Access Your Best Self With Mind-Body Practices, Belief Testing & Imagination";

		expect(titleTokenSimilarity(current, legacy)).toBe(1);
	});

	it("treats stripped ellipses as the same title as the dotted form", () => {
		const current = "Philosophize This! - Episode 001 ... Presocratic Philosophy - Ionian";
		const legacy = "Philosophize This! - Episode 001 Presocratic Philosophy - Ionian";

		expect(titleTokens(current)).toEqual(titleTokens(legacy));
		expect(titleTokenSimilarity(current, legacy)).toBe(1);
	});

	it("does not match distinct numbered episodes", () => {
		expect(
			titleTokenSimilarity(
				"Episode #001 ... Presocratic Philosophy - Ionian",
				"Episode #007 ... Daoism",
			),
		).toBe(0);
		expect(
			titleTokenSimilarity(
				"The History of Rome: The Fall of the Republic, Part 1",
				"The History of Rome: The Fall of the Republic, Part 2",
			),
		).toBe(0);
	});

	it("treats padded and unpadded episode numbers as the same number", () => {
		expect(titleTokenSimilarity("Episode 001 The Beginning", "Episode 1 The Beginning")).toBe(
			1,
		);
	});

	it("returns the unique strong match", () => {
		const episodes = [
			{ title: "Access Your Best Self | Dr. Martha Beck" },
			{ title: "Optimize Testosterone | Dr. Kyle Gillett" },
		];

		expect(
			findUniqueTitleMatch(
				["Dr. Martha Beck: Access Your Best Self"],
				episodes,
				(episode) => episode.title,
			),
		).toEqual(episodes[0]);
	});

	it("refuses two candidates at the same qualifying score", () => {
		expect(
			findUniqueTitleMatch(
				["Weekly News Roundup"],
				[{ title: "Weekly News Roundup Extra" }, { title: "Weekly News Roundup Bonus" }],
				(episode) => episode.title,
			),
		).toBeUndefined();
	});
});
