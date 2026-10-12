import { describe, expect, test } from "vitest";
import recorded from "../../tests/fixtures/fuzzy-search/fuse-7.5.0.json";
import { fuzzySearch } from "./fuzzySearch";

function rankAll(texts: string[], queries: [string, number[]][], findAllMatches: boolean) {
	const indices = texts.map((_, index) => index);
	return queries.map(([query]) => [
		query,
		fuzzySearch(query, indices, (index) => texts[index], { findAllMatches }),
	]);
}

describe("fuzzySearch ranks exactly as fuse.js 7.5.0 did", () => {
	test("episode titles", () => {
		const queries = recorded.titleQueries as [string, number[]][];

		expect(queries).toHaveLength(150);
		expect(rankAll(recorded.titles, queries, true)).toEqual(queries);
	});

	test("template tag names", () => {
		const queries = recorded.tagQueries as [string, number[]][];

		expect(queries).toHaveLength(80);
		expect(rankAll(recorded.tags, queries, false)).toEqual(queries);
	});
});
