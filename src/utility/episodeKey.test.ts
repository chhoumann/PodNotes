import { describe, expect, it } from "vitest";

import type { Episode } from "src/types/Episode";
import { getEpisodeKey, isSameStoredEpisode } from "./episodeKey";

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

describe("getEpisodeKey", () => {
	it("keeps the plain podcastName::title format for ordinary episodes (backward compatible)", () => {
		expect(getEpisodeKey(ep("Episode 1", "My Podcast"))).toBe(
			"My Podcast::Episode 1",
		);
	});

	it("keeps the plain format when names/titles carry single colons", () => {
		// Single colons cannot forge the `::` delimiter, so these stay verbatim and
		// need no migration.
		expect(getEpisodeKey(ep("Ch 5: The Return", "Serial: A Show"))).toBe(
			"Serial: A Show::Ch 5: The Return",
		);
	});

	it("falls back to the title for legacy episodes without a podcastName", () => {
		expect(getEpisodeKey(ep("Legacy Title"))).toBe("Legacy Title");
	});

	it("returns an empty string when episode or title is missing", () => {
		expect(getEpisodeKey(undefined)).toBe("");
		expect(getEpisodeKey(null)).toBe("");
		expect(getEpisodeKey(ep(""))).toBe("");
	});

	it("does not collide when the delimiter appears inside a component (#other-key-collision)", () => {
		// Both pairs used to map to "A::B::C".
		const a = getEpisodeKey(ep("B::C", "A")); // podcastName "A", title "B::C"
		const b = getEpisodeKey(ep("C", "A::B")); // podcastName "A::B", title "C"
		expect(a).not.toBe(b);
	});

	it("does not collide when a name ends with / a title starts with the delimiter colon", () => {
		// Both pairs used to map to "A:::B".
		const a = getEpisodeKey(ep("B", "A:")); // ("A:", "B")
		const b = getEpisodeKey(ep(":B", "A")); // ("A", ":B")
		expect(a).not.toBe(b);
	});

	it("keeps escaped keys disjoint from plain keys (no `::`)", () => {
		const encoded = getEpisodeKey(ep("B::C", "A"));
		expect(encoded.includes("::")).toBe(false);
		expect(encoded).not.toBe(getEpisodeKey(ep("Plain", "Podcast")));
	});

	it("keeps escaped keys disjoint from legacy title-only keys", () => {
		// A feed with an empty <title> produces podcastName="" -> a raw-title key.
		// The escaped form minus its (NUL) prefix is an ordinary title a feed could
		// carry, so a legacy episode with that title must NOT alias another feed's
		// escaped composite key.
		const escaped = getEpisodeKey(ep("a", ":")); // podcastName=":", title="a"
		expect(escaped.charCodeAt(0)).toBe(0); // the NUL prefix is present
		const realisticTitle = escaped.slice(1); // an ordinary, NUL-free title
		expect(getEpisodeKey(ep(realisticTitle))).not.toBe(escaped);
	});

	it("maps a batch of delimiter-adjacent pairs to distinct keys (injective)", () => {
		const pairs: Array<[name: string, title: string]> = [
			["A", "B::C"],
			["A::B", "C"],
			["A:", "B"],
			["A", ":B"],
			["A::B::C", "D"],
			["A", "B"],
			["A:", ":B"],
			[":A", "B:"],
		];
		const keys = pairs.map(([name, title]) => getEpisodeKey(ep(title, name)));
		expect(new Set(keys).size).toBe(pairs.length);
	});

	it("treats __proto__/constructor names as ordinary string keys", () => {
		expect(getEpisodeKey(ep("Ep", "__proto__"))).toBe("__proto__::Ep");
		expect(typeof getEpisodeKey(ep("Ep", "constructor"))).toBe("string");
	});

	it("never throws on a delimiter-forging value containing a lone surrogate", () => {
		// encodeURIComponent would throw URIError here; the manual escape must not,
		// so a hostile feed value cannot crash key generation.
		expect(() => getEpisodeKey(ep("::\uD800", "Pod"))).not.toThrow();
		const key = getEpisodeKey(ep("::\uD800", "Pod"));
		expect(key.includes("::")).toBe(false);
	});
});

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

	it("does not conflate two feeds that forge the `::` delimiter (#other-key-collision)", () => {
		// ("A", "B::C") and ("A::B", "C") used to share the key "A::B::C".
		expect(isSameStoredEpisode(ep("B::C", "A"), ep("C", "A::B"))).toBe(false);
	});

	it("returns false for null/undefined inputs", () => {
		expect(isSameStoredEpisode(undefined, ep("E1", "Pod"))).toBe(false);
		expect(isSameStoredEpisode(ep("E1", "Pod"), null)).toBe(false);
	});
});
