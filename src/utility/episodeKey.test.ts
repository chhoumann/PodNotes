import { describe, expect, it } from "vitest";

import type { Episode } from "src/types/Episode";
import { isSameStoredEpisode } from "./episodeKey";

function ep(title: string, podcastName?: string): Episode {
	return {
		title,
		podcastName,
		streamUrl: "",
		url: "",
		description: "",
		content: "",
	} as unknown as Episode;
}

describe("isSameStoredEpisode (#214)", () => {
	it("matches the same podcast + title (composite key)", () => {
		expect(isSameStoredEpisode(ep("E1", "Pod"), ep("E1", "Pod"))).toBe(true);
	});

	it("does NOT match a same-titled episode from a different podcast", () => {
		// The PB-07 invariant: a different podcast's same title must not match.
		expect(isSameStoredEpisode(ep("E1", "Other"), ep("E1", "Pod"))).toBe(false);
	});

	it("matches a LEGACY stored entry (no podcastName) by title against a composite current episode", () => {
		// episodeMatchesKey alone returns false here; this is the regression #214 fixes.
		expect(isSameStoredEpisode(ep("E1"), ep("E1", "Pod"))).toBe(true);
	});

	it("does not match different titles", () => {
		expect(isSameStoredEpisode(ep("E1", "Pod"), ep("E2", "Pod"))).toBe(false);
		expect(isSameStoredEpisode(ep("E1"), ep("E2", "Pod"))).toBe(false);
	});

	it("returns false for null/undefined inputs", () => {
		expect(isSameStoredEpisode(undefined, ep("E1", "Pod"))).toBe(false);
		expect(isSameStoredEpisode(ep("E1", "Pod"), null)).toBe(false);
	});
});
