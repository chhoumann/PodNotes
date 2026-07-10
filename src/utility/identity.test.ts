import { describe, expect, test } from "vitest";
import {
	MAX_EPISODE_IDENTITY_ALIASES,
	MAX_IDENTITY_COMPONENT_BYTES,
	assignEpisodeIdentities,
	createFeedId,
	createLocalEpisodeId,
	getEpisodeIdentityCandidates,
	isCanonicalEpisodeId,
	isCanonicalFeedId,
	normalizeStrongIdentityUrl,
	reconcileEpisodeIdentities,
	type EpisodeIdentitySource,
} from "./identity";

const feedId = createFeedId("https://example.com/feed.xml")!;

function source(overrides: Partial<EpisodeIdentitySource> = {}): EpisodeIdentitySource {
	return {
		feedId,
		guid: "episode-guid",
		enclosureUrl: "https://cdn.example.com/episode.mp3?token=secret&part=1",
		itemLink: "https://example.com/episodes/1",
		publishedAt: "2024-01-01T00:00:00.000Z",
		title: "Episode 1",
		...overrides,
	};
}

function previousEntries(sources: EpisodeIdentitySource[]) {
	const assigned = assignEpisodeIdentities(sources);
	return sources.map((episodeSource, index) => ({
		episodeId: assigned[index]?.episodeId,
		source: episodeSource,
	}));
}

function persistedEntries(sources: EpisodeIdentitySource[]) {
	const assigned = assignEpisodeIdentities(sources);
	return sources.map((episodeSource, index) => ({
		episodeId: assigned[index]?.episodeId,
		aliases: assigned[index]?.aliases,
		source: episodeSource,
	}));
}

describe("canonical identity IDs", () => {
	test("uses a stable, fixed-length SHA-256 base64url grammar", () => {
		expect(feedId).toBe("pnf1_1FkzYRu7QhyXP_UmFwiNli7Pz-Fvl0Mun3-mvl4k2_8");
		expect(feedId).toMatch(/^pnf1_[A-Za-z0-9_-]{43}$/);
		expect(isCanonicalFeedId(feedId)).toBe(true);
		expect(getEpisodeIdentityCandidates(source())[0]?.id).toMatch(/^pne1_[A-Za-z0-9_-]{43}$/);
	});

	test.each([
		undefined,
		null,
		{},
		"pnf1_",
		`pnf1_${"A".repeat(42)}`,
		`pnf1_${"A".repeat(44)}`,
		`pnf1_${"A".repeat(42)}=`,
		`pnf1_${"A".repeat(42)}\n`,
		`__proto__`,
	])("rejects malformed feed IDs without throwing: %j", (candidate) => {
		expect(() => isCanonicalFeedId(candidate)).not.toThrow();
		expect(isCanonicalFeedId(candidate)).toBe(false);
	});

	test.each([
		undefined,
		null,
		{},
		"pne1_",
		`pne1_${"A".repeat(42)}`,
		`pne1_${"A".repeat(44)}`,
		`pne1_${"A".repeat(42)}=`,
		`pne1_${"A".repeat(42)}\u0000`,
	])("rejects malformed episode IDs without throwing: %j", (candidate) => {
		expect(() => isCanonicalEpisodeId(candidate)).not.toThrow();
		expect(isCanonicalEpisodeId(candidate)).toBe(false);
	});

	test("keeps feed and episode domains disjoint", () => {
		const episodeId = getEpisodeIdentityCandidates(source())[0]?.id;
		expect(isCanonicalEpisodeId(episodeId)).toBe(true);
		expect(isCanonicalFeedId(episodeId)).toBe(false);
		expect(isCanonicalEpisodeId(feedId)).toBe(false);
	});

	test("bounds untrusted inputs and handles lone surrogates deterministically", () => {
		const oversized = `https://example.com/${"a".repeat(MAX_IDENTITY_COMPONENT_BYTES)}`;
		expect(createFeedId(oversized)).toBeUndefined();

		const loneSurrogate = createFeedId("https://example.com/\ud800");
		const replacementCharacter = createFeedId("https://example.com/�");
		expect(loneSurrogate).toBeUndefined();
		expect(replacementCharacter).toBeDefined();
		expect(() => createFeedId("https://example.com/\ud800")).not.toThrow();
		expect(createFeedId("https://example.com/feed\n.xml")).toBeUndefined();
	});

	test("rejects invalid feed URLs and ignores fragments in feed identity", () => {
		expect(createFeedId("not a URL")).toBeUndefined();
		expect(createFeedId("https://example.com/feed.xml#first")).toBe(
			createFeedId("https://example.com/feed.xml#second"),
		);
	});

	test.each([{}, [], 1, Symbol("url"), 1n])(
		"rejects non-string URL sources without throwing",
		(candidate) => {
			expect(() => createFeedId(candidate)).not.toThrow();
			expect(createFeedId(candidate)).toBeUndefined();
			expect(normalizeStrongIdentityUrl(candidate)).toBeUndefined();
		},
	);
});

describe("strong URL and path identity", () => {
	test("removes only the URL fragment", () => {
		expect(
			normalizeStrongIdentityUrl(
				"HTTPS://Example.COM:443/a/../episode.mp3?b=2&a=1&token=secret#chapter",
			),
		).toBe("https://example.com/episode.mp3?b=2&a=1&token=secret");
	});

	test("preserves query order and authentication parameters", () => {
		const first = createFeedId("https://example.com/feed?b=2&a=1&token=first");
		const reordered = createFeedId("https://example.com/feed?a=1&b=2&token=first");
		const rotated = createFeedId("https://example.com/feed?b=2&a=1&token=second");
		expect(first).not.toBe(reordered);
		expect(first).not.toBe(rotated);
	});

	test("does not trim or reduce caller-normalized local vault paths", () => {
		const nested = createLocalEpisodeId(feedId, "shows/a/episode.mp3");
		const otherFolder = createLocalEpisodeId(feedId, "shows/b/episode.mp3");
		const leadingSpace = createLocalEpisodeId(feedId, " shows/a/episode.mp3");
		expect(nested).not.toBe(otherFolder);
		expect(nested).not.toBe(leadingSpace);
	});

	test("rejects invalid feed IDs and impossible local paths at runtime", () => {
		expect(createLocalEpisodeId("not-a-feed-id", "shows/episode.mp3")).toBeUndefined();
		expect(createLocalEpisodeId(feedId, "")).toBeUndefined();
		expect(createLocalEpisodeId(feedId, "shows/\u0000episode.mp3")).toBeUndefined();
		expect(createLocalEpisodeId(feedId, { path: "shows/episode.mp3" })).toBeUndefined();
		expect(createLocalEpisodeId(Symbol("feed"), "shows/episode.mp3")).toBeUndefined();
	});
});

describe("whole-feed episode identity assignment", () => {
	test("scopes the same item GUID to its feed", () => {
		const otherFeedId = createFeedId("https://other.example/feed.xml")!;
		const first = assignEpisodeIdentities([source()])[0]?.episodeId;
		const second = assignEpisodeIdentities([source({ feedId: otherFeedId })])[0]?.episodeId;
		expect(first).not.toBe(second);
	});

	test("keeps a stable GUID identity across title and enclosure changes", () => {
		const before = assignEpisodeIdentities([source()])[0]?.episodeId;
		const after = assignEpisodeIdentities([
			source({
				title: "Renamed episode",
				enclosureUrl: "https://cdn.example.com/replaced.mp3",
				itemLink: "https://example.com/episodes/renamed",
			}),
		])[0]?.episodeId;
		expect(before).toBe(after);
	});

	test("does not equate same-titled episodes when every strong locator changes", () => {
		const before = assignEpisodeIdentities([source()])[0]?.episodeId;
		const after = assignEpisodeIdentities([
			source({
				guid: "other-guid",
				enclosureUrl: "https://cdn.example.com/other.mp3",
				itemLink: "https://example.com/episodes/other",
			}),
		])[0]?.episodeId;
		expect(before).not.toBe(after);
	});

	test("handles control characters and lone surrogates in opaque GUIDs safely", () => {
		const control = source({ guid: "guid\u0000value" });
		const escaped = source({ guid: "guid\\u0000value" });
		const surrogate = source({ guid: "guid\ud800value" });
		expect(() => assignEpisodeIdentities([control, escaped, surrogate])).not.toThrow();
		const ids = assignEpisodeIdentities([control, escaped, surrogate]).map(
			(identity) => identity.episodeId,
		);
		expect(new Set(ids).size).toBe(3);
	});

	test("returns no identity without a valid canonical feed ID", () => {
		expect(assignEpisodeIdentities([source({ feedId: "" })])[0]?.episodeId).toBeUndefined();
		expect(
			assignEpisodeIdentities([source({ feedId: "pnf1_forged" })])[0]?.episodeId,
		).toBeUndefined();
	});

	test("rejects non-record sources and invalid component types without throwing", () => {
		const throwingGetter = Object.defineProperty({}, "feedId", {
			get() {
				throw new Error("untrusted getter");
			},
		});
		const invalid = [
			null,
			[],
			1,
			Symbol("source"),
			throwingGetter,
			{ ...source(), title: 1 },
			{ ...source(), enclosureUrl: {} },
			{ ...source(), guid: [] },
			{ ...source(), itemLink: 1n },
		];
		for (const candidate of invalid) {
			expect(() => getEpisodeIdentityCandidates(candidate)).not.toThrow();
			expect(getEpisodeIdentityCandidates(candidate)).toEqual([]);
		}
		expect(assignEpisodeIdentities("not an array")).toEqual([]);
		expect(assignEpisodeIdentities(invalid)).toHaveLength(invalid.length);
	});

	test("excludes a duplicated GUID and falls through to unique enclosures", () => {
		const sources = [
			source({ enclosureUrl: "https://cdn.example.com/one.mp3", itemLink: undefined }),
			source({
				title: "Episode 2",
				enclosureUrl: "https://cdn.example.com/two.mp3",
				itemLink: undefined,
				publishedAt: "2024-01-02T00:00:00.000Z",
			}),
		];
		const assigned = assignEpisodeIdentities(sources);
		const candidates = sources.map(getEpisodeIdentityCandidates);

		expect(assigned[0]?.episodeId).toBe(
			candidates[0].find((candidate) => candidate.kind === "media")?.id,
		);
		expect(assigned[1]?.episodeId).toBe(
			candidates[1].find((candidate) => candidate.kind === "media")?.id,
		);
		const duplicatedGuid = candidates[0].find((candidate) => candidate.kind === "guid")?.id;
		expect(assigned[0]?.aliases).not.toContain(duplicatedGuid);
		expect(assigned[1]?.aliases).not.toContain(duplicatedGuid);
	});

	test("excludes duplicated GUID and enclosure candidates before using item links", () => {
		const shared = {
			guid: "duplicate-guid",
			enclosureUrl: "https://cdn.example.com/shared.mp3",
		};
		const sources = [
			source({ ...shared, itemLink: "https://example.com/one" }),
			source({
				...shared,
				title: "Episode 2",
				itemLink: "https://example.com/two",
				publishedAt: "2024-01-02T00:00:00.000Z",
			}),
		];
		const assigned = assignEpisodeIdentities(sources);
		const candidates = sources.map(getEpisodeIdentityCandidates);
		expect(assigned[0]?.episodeId).toBe(
			candidates[0].find((candidate) => candidate.kind === "itemLink")?.id,
		);
		expect(assigned[1]?.episodeId).toBe(
			candidates[1].find((candidate) => candidate.kind === "itemLink")?.id,
		);
	});

	test("uses distinct source tuples when every strong locator is duplicated", () => {
		const shared = {
			guid: "duplicate-guid",
			enclosureUrl: "https://cdn.example.com/shared.mp3",
			itemLink: "https://example.com/shared",
		};
		const sources = [
			source({ ...shared }),
			source({
				...shared,
				title: "Episode 2",
				publishedAt: "2024-01-02T00:00:00.000Z",
			}),
		];
		const assigned = assignEpisodeIdentities(sources);
		expect(assigned[0]?.episodeId).toBe(
			getEpisodeIdentityCandidates(sources[0]).find(
				(candidate) => candidate.kind === "source",
			)?.id,
		);
		expect(assigned[1]?.episodeId).toBe(
			getEpisodeIdentityCandidates(sources[1]).find(
				(candidate) => candidate.kind === "source",
			)?.id,
		);
		expect(assigned[0]?.episodeId).not.toBe(assigned[1]?.episodeId);
	});

	test("treats exact repeated source tuples as one logical identity", () => {
		const episode = source();
		const assigned = assignEpisodeIdentities([episode, { ...episode }]);
		expect(assigned[0]?.episodeId).toBe(assigned[1]?.episodeId);
	});

	test("never creates an item-link alias from the feed URL fallback", () => {
		const candidates = getEpisodeIdentityCandidates(source({ itemLink: undefined }));
		expect(candidates.some((candidate) => candidate.kind === "itemLink")).toBe(false);
	});

	test("fails closed when an oversized tuple shares a strong alias", () => {
		const oversizedTitle = "x".repeat(MAX_IDENTITY_COMPONENT_BYTES);
		const assigned = assignEpisodeIdentities([
			source({ title: oversizedTitle, enclosureUrl: "not a URL", itemLink: undefined }),
			source({ title: `${oversizedTitle}y`, enclosureUrl: "not a URL", itemLink: undefined }),
		]);
		expect(assigned[0]?.episodeId).toBeUndefined();
		expect(assigned[1]?.episodeId).toBeUndefined();
	});
});

describe("whole-feed reconciliation", () => {
	test("retains an ID when a GUID appears and later changes through stable media evidence", () => {
		const initialSource = source({ guid: undefined });
		const [initial] = previousEntries([initialSource]);
		const withGuid = source({ guid: "new-guid" });
		const [firstRefresh] = reconcileEpisodeIdentities([initial], [withGuid]);
		expect(firstRefresh.episodeId).toBe(initial.episodeId);
		expect(firstRefresh.aliases).toContain(initial.episodeId);

		const changedGuid = source({ guid: "changed-guid" });
		const [secondRefresh] = reconcileEpisodeIdentities(
			[{ episodeId: firstRefresh.episodeId, source: withGuid }],
			[changedGuid],
		);
		expect(secondRefresh.episodeId).toBe(initial.episodeId);
	});

	test("rejects a valid substituted prior ID when aliases do not contain it", () => {
		const episodeSource = source();
		const [previous] = persistedEntries([episodeSource]);
		const forgedId = assignEpisodeIdentities([source({ guid: "forged-id-source" })])[0]
			?.episodeId;
		const [current] = reconcileEpisodeIdentities(
			[{ ...previous, episodeId: forgedId }],
			[episodeSource],
		);

		expect(forgedId).toBeDefined();
		expect(previous.aliases).not.toContain(forgedId);
		expect(current.episodeId).toBe(previous.episodeId);
		expect(current.episodeId).not.toBe(forgedId);
	});

	test("does not resurrect a duplicate GUID from a truncated prior observation", () => {
		const previousSources = [
			source({
				guid: "duplicated-guid",
				enclosureUrl: "https://cdn.example.com/one.mp3",
				itemLink: undefined,
			}),
			source({
				guid: "duplicated-guid",
				title: "Episode 2",
				enclosureUrl: "https://cdn.example.com/two.mp3",
				itemLink: undefined,
				publishedAt: "2024-01-02T00:00:00.000Z",
			}),
		];
		const [firstPersisted] = persistedEntries(previousSources);
		const duplicateGuidId = getEpisodeIdentityCandidates(previousSources[0]).find(
			(candidate) => candidate.kind === "guid",
		)?.id;
		const changedSource = {
			...previousSources[0],
			enclosureUrl: "https://cdn.example.com/replaced.mp3",
		};
		const [current] = reconcileEpisodeIdentities([firstPersisted], [changedSource]);

		expect(firstPersisted.aliases).not.toContain(duplicateGuidId);
		expect(current.episodeId).not.toBe(firstPersisted.episodeId);
	});

	test("retains the original ID across an A to B bridge and A locator reversion", () => {
		const sourceA = source({
			guid: "guid-a",
			enclosureUrl: "https://cdn.example.com/bridge.mp3",
			itemLink: "https://example.com/a",
		});
		const [persistedA] = persistedEntries([sourceA]);
		const sourceB = source({
			guid: "guid-b",
			enclosureUrl: "https://cdn.example.com/bridge.mp3",
			itemLink: "https://example.com/b",
		});
		const [observedB] = reconcileEpisodeIdentities([persistedA], [sourceB]);
		expect(observedB.episodeId).toBe(persistedA.episodeId);

		const sourceAReverted = source({
			guid: "guid-a",
			enclosureUrl: "https://cdn.example.com/reverted.mp3",
			itemLink: "https://example.com/a-reverted",
		});
		const [reverted] = reconcileEpisodeIdentities(
			[{ episodeId: observedB.episodeId, aliases: observedB.aliases, source: sourceB }],
			[sourceAReverted],
		);
		expect(reverted.episodeId).toBe(persistedA.episodeId);
		expect(reverted.aliases.length).toBeLessThanOrEqual(MAX_EPISODE_IDENTITY_ALIASES);
	});

	test("retains IDs when a formerly unique GUID becomes ambiguous", () => {
		const previousSources = [
			source({ guid: "guid-one", enclosureUrl: "https://cdn.example.com/one.mp3" }),
			source({
				guid: "guid-two",
				title: "Episode 2",
				enclosureUrl: "https://cdn.example.com/two.mp3",
				itemLink: "https://example.com/episodes/2",
				publishedAt: "2024-01-02T00:00:00.000Z",
			}),
		];
		const previous = previousEntries(previousSources);
		const currentSources = previousSources.map((episodeSource) => ({
			...episodeSource,
			guid: "now-duplicated",
		}));
		const current = reconcileEpisodeIdentities(previous, currentSources);
		expect(current.map((identity) => identity.episodeId)).toEqual(
			previous.map((identity) => identity.episodeId),
		);
	});

	test("retains IDs when a previously ambiguous GUID becomes unique", () => {
		const previousSources = [
			source({ guid: "duplicated", enclosureUrl: "https://cdn.example.com/one.mp3" }),
			source({
				guid: "duplicated",
				title: "Episode 2",
				enclosureUrl: "https://cdn.example.com/two.mp3",
				itemLink: "https://example.com/episodes/2",
				publishedAt: "2024-01-02T00:00:00.000Z",
			}),
		];
		const previous = previousEntries(previousSources);
		const currentSources = previousSources.map((episodeSource, index) => ({
			...episodeSource,
			guid: `now-unique-${index}`,
		}));
		const current = reconcileEpisodeIdentities(previous, currentSources);
		expect(current.map((identity) => identity.episodeId)).toEqual(
			previous.map((identity) => identity.episodeId),
		);
	});

	test("refuses to retain an ID when prior evidence splits across current items", () => {
		const previousSource = source();
		const assignedPrevious = assignEpisodeIdentities([previousSource])[0];
		const historicalId = assignEpisodeIdentities([source({ guid: "historical-id-source" })])[0]
			?.episodeId;
		if (!historicalId) throw new Error("Expected a historical canonical ID");
		const previous = {
			episodeId: historicalId,
			aliases: [historicalId, ...assignedPrevious.aliases],
			source: previousSource,
		};
		const currentSources = [
			{
				...previousSource,
				title: "GUID branch",
				enclosureUrl: "https://cdn.example.com/guid-branch.mp3",
				itemLink: "https://example.com/guid-branch",
				publishedAt: "2024-01-02T00:00:00.000Z",
			},
			{
				...previousSource,
				guid: "media-branch-guid",
				title: "Media branch",
				publishedAt: "2024-01-03T00:00:00.000Z",
			},
		];
		const current = reconcileEpisodeIdentities([previous], currentSources);
		expect(current.every((identity) => identity.episodeId !== historicalId)).toBe(true);
	});

	test("refuses to retain either ID when current evidence merges two prior items", () => {
		const previousSources = [
			source({
				guid: "guid-one",
				enclosureUrl: "https://cdn.example.com/one.mp3",
				itemLink: "https://example.com/one",
			}),
			source({
				guid: "guid-two",
				title: "Episode 2",
				enclosureUrl: "https://cdn.example.com/two.mp3",
				itemLink: "https://example.com/two",
				publishedAt: "2024-01-02T00:00:00.000Z",
			}),
		];
		const previous = previousEntries(previousSources);
		const merged = source({
			guid: "brand-new-guid",
			enclosureUrl: previousSources[0].enclosureUrl,
			itemLink: previousSources[1].itemLink,
		});
		const [current] = reconcileEpisodeIdentities(previous, [merged]);
		expect(previous.map((identity) => identity.episodeId)).not.toContain(current.episodeId);
	});

	test("never bridges observations through a source-tuple fallback", () => {
		const previousSource = source({
			guid: undefined,
			enclosureUrl: "invalid enclosure one",
			itemLink: undefined,
		});
		const [previous] = previousEntries([previousSource]);
		const currentSource = {
			...previousSource,
			enclosureUrl: "invalid enclosure two",
		};
		const [current] = reconcileEpisodeIdentities([previous], [currentSource]);

		expect(previous.episodeId).toBeDefined();
		expect(current.aliases).toEqual([]);
		expect(current.episodeId).not.toBe(previous.episodeId);
	});

	test("ignores malformed or duplicated prior canonical IDs", () => {
		const episodeSource = source();
		const currentOnlyId = assignEpisodeIdentities([episodeSource])[0]?.episodeId;
		expect(
			reconcileEpisodeIdentities(
				[{ episodeId: "forged", source: episodeSource }],
				[episodeSource],
			)[0]?.episodeId,
		).toBe(currentOnlyId);

		const priorSource = source({ guid: "prior-guid" });
		const validId = assignEpisodeIdentities([priorSource])[0]?.episodeId;
		if (!validId) throw new Error("Expected a canonical prior episode ID");
		const duplicatePrevious = [
			{ episodeId: validId, source: priorSource },
			{
				episodeId: validId,
				source: source({
					guid: "unrelated-guid",
					enclosureUrl: "https://unrelated.example/episode.mp3",
					itemLink: "https://unrelated.example/episode",
				}),
			},
		];
		const changedGuid = source({ guid: "changed-guid" });
		expect(reconcileEpisodeIdentities(duplicatePrevious, [changedGuid])[0]?.episodeId).not.toBe(
			validId,
		);

		const oversizedAliases = Array.from(
			{ length: MAX_EPISODE_IDENTITY_ALIASES + 1 },
			(_, index) =>
				assignEpisodeIdentities([source({ guid: `oversized-alias-${index}` })])[0]
					?.episodeId,
		);
		const oversizedPrior = {
			episodeId: oversizedAliases[0],
			aliases: oversizedAliases,
			source: priorSource,
		};
		expect(reconcileEpisodeIdentities([oversizedPrior], [changedGuid])[0]?.episodeId).not.toBe(
			oversizedPrior.episodeId,
		);

		const sparseSource = source({ guid: "sparse-old-guid" });
		const [sparsePersisted] = persistedEntries([sparseSource]);
		const mediaAlias = getEpisodeIdentityCandidates(sparseSource).find(
			(candidate) => candidate.kind === "media",
		)?.id;
		const sparseAliases: unknown[] = [];
		sparseAliases.length = 3;
		sparseAliases[0] = sparsePersisted.episodeId;
		sparseAliases[2] = mediaAlias;
		const sparseCurrent = source({
			guid: "sparse-new-guid",
			itemLink: "https://example.com/sparse-new-link",
		});
		expect(
			reconcileEpisodeIdentities(
				[{ ...sparsePersisted, aliases: sparseAliases }],
				[sparseCurrent],
			)[0]?.episodeId,
		).not.toBe(sparsePersisted.episodeId);

		const hostileAliases = [sparsePersisted.episodeId, mediaAlias];
		Object.defineProperty(hostileAliases, 1, {
			get() {
				throw new Error("untrusted alias getter");
			},
		});
		let hostileResult = reconcileEpisodeIdentities([], []);
		expect(() => {
			hostileResult = reconcileEpisodeIdentities(
				[{ ...sparsePersisted, aliases: hostileAliases }],
				[sparseCurrent],
			);
		}).not.toThrow();
		expect(hostileResult[0]?.episodeId).not.toBe(sparsePersisted.episodeId);
	});
});
