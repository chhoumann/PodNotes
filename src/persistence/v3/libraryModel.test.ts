import { describe, expect, it } from "vitest";
import {
	decodeLibraryV3,
	encodeLibraryV3,
	portableVaultPathOwnershipKey,
	validateLibraryV3,
} from "./libraryModel";
import {
	cloneLibrary,
	foreignCapabilityRef,
	foreignFeedId,
	localEpisodeId,
	missingEpisodeId,
	remoteEpisodeId,
	remoteFeedId,
	secondRemoteEpisodeId,
	validLibrary,
} from "./__tests__/fixtures";

describe("schema-v3 target-free library model", () => {
	it("normalizes dates and has a stable deterministic round trip", () => {
		const first = validateLibraryV3(validLibrary());
		expect(first).not.toBeNull();
		expect(first?.episodes[remoteEpisodeId]?.episodeDate).toBe("2026-07-10T10:20:30.000Z");
		expect(first?.episodes[remoteEpisodeId]).not.toHaveProperty("podcastName");

		const reversed = cloneLibrary();
		reversed.feeds = Object.fromEntries(Object.entries(reversed.feeds).reverse());
		reversed.episodes = Object.fromEntries(Object.entries(reversed.episodes).reverse());
		const encoded = encodeLibraryV3(validLibrary());
		expect(encodeLibraryV3(reversed)).toBe(encoded);
		expect(encodeLibraryV3(decodeLibraryV3(encoded))).toBe(encoded);
	});

	it("uses Gregorian leap-year rules for early four-digit years", () => {
		const value = cloneLibrary();
		value.episodes[remoteEpisodeId].episodeDate = "0096-02-29T00:00:00Z";

		expect(validateLibraryV3(value)?.episodes[remoteEpisodeId]?.episodeDate).toBe(
			"0096-02-29T00:00:00.000Z",
		);
	});

	it("uses handles rather than titles as episode identity", () => {
		const value = cloneLibrary();
		value.episodes[secondRemoteEpisodeId] = {
			...value.episodes[remoteEpisodeId],
			episodeId: secondRemoteEpisodeId,
		};

		const normalized = validateLibraryV3(value);
		expect(normalized?.episodes[remoteEpisodeId]?.title).toBe("Remote episode");
		expect(normalized?.episodes[secondRemoteEpisodeId]?.title).toBe("Remote episode");
	});

	it("sorts download assets with a deterministic code-unit order", () => {
		const value = cloneLibrary();
		value.downloads[remoteEpisodeId] = [
			{ filePath: "Audio/a.mp3", size: 2 },
			{ filePath: "Audio/Z.mp3", size: 1 },
		];

		expect(validateLibraryV3(value)?.downloads[remoteEpisodeId]).toEqual([
			{ filePath: "Audio/Z.mp3", size: 1 },
			{ filePath: "Audio/a.mp3", size: 2 },
		]);
	});

	it("derives a locale-independent Unicode-normalized path ownership key", () => {
		expect(portableVaultPathOwnershipKey("Audio/CAFE\u0301.mp3")).toBe(
			portableVaultPathOwnershipKey("audio/caf\u00e9.mp3"),
		);
	});

	it("binds a remote feed to its exact capability reference", () => {
		const value = cloneLibrary();
		value.feeds[remoteFeedId].capabilityRef = foreignCapabilityRef;
		expect(validateLibraryV3(value)).toBeNull();
	});

	it("preserves duplicate playlist positions and rejects missing episode references", () => {
		const duplicate = cloneLibrary();
		duplicate.queue.episodeIds.push(remoteEpisodeId);
		expect(validateLibraryV3(duplicate)?.queue.episodeIds).toEqual([
			remoteEpisodeId,
			remoteEpisodeId,
		]);

		const missing = cloneLibrary();
		missing.favorites.episodeIds.push(missingEpisodeId);
		expect(validateLibraryV3(missing)).toBeNull();

		const detachedCurrent = cloneLibrary();
		detachedCurrent.queue.currentEpisodeId = localEpisodeId;
		expect(validateLibraryV3(detachedCurrent)).toBeNull();
	});

	it("rejects mismatched map keys", () => {
		const feed = cloneLibrary();
		feed.feeds[remoteFeedId].feedId = foreignFeedId;
		expect(validateLibraryV3(feed)).toBeNull();

		const episode = cloneLibrary();
		episode.episodes[remoteEpisodeId].episodeId = missingEpisodeId;
		expect(validateLibraryV3(episode)).toBeNull();

		const progress = cloneLibrary();
		progress.progress[remoteEpisodeId].episodeId = localEpisodeId;
		expect(validateLibraryV3(progress)).toBeNull();

		const note = cloneLibrary();
		note.podNotes[remoteEpisodeId].episodeId = localEpisodeId;
		expect(validateLibraryV3(note)).toBeNull();

		const localAsset = cloneLibrary();
		localAsset.localAssets[localEpisodeId].episodeId = remoteEpisodeId;
		expect(validateLibraryV3(localAsset)).toBeNull();
	});

	it("keeps the reserved extension namespace strict, versioned, and empty", () => {
		const data = cloneLibrary();
		data.extensions.unresolved = [];
		expect(validateLibraryV3(data)).toBeNull();

		const version = cloneLibrary();
		version.extensions.schemaVersion = 2;
		expect(validateLibraryV3(version)).toBeNull();
	});
});
