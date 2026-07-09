import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";

import type { Episode } from "src/types/Episode";
import { downloadedEpisodes } from "./downloads";

function makeEpisode(overrides: Partial<Episode> = {}): Episode {
	return {
		title: "Recording",
		streamUrl: "",
		url: "Folder A/Recording.mp3",
		description: "",
		content: "",
		podcastName: "local file",
		episodeDate: undefined,
		artworkUrl: "",
		...overrides,
	} as unknown as Episode;
}

describe("downloadedEpisodes.addEpisode basename collision (#LF-06)", () => {
	beforeEach(() => {
		downloadedEpisodes.set({});
	});

	it("returns the replaced path when an existing same-key entry has a different filePath", () => {
		expect(
			downloadedEpisodes.addEpisode(makeEpisode(), "Folder A/Recording.mp3", 10),
		).toBeUndefined();

		// Same podcastName + title, DIFFERENT path -> basename collision. The store
		// stays pure (no Notice); it signals the collision to the caller, which warns.
		const replaced = downloadedEpisodes.addEpisode(makeEpisode(), "Folder B/Recording.mp3", 20);
		expect(replaced).toBe("Folder A/Recording.mp3");

		// Behavior is otherwise unchanged: the single entry is replaced in place,
		// and the canonical podcastName+title key is preserved (not made unique).
		const entries = get(downloadedEpisodes)["local file"];
		expect(entries).toHaveLength(1);
		expect(entries?.[0]?.filePath).toBe("Folder B/Recording.mp3");
	});

	it("returns undefined when re-adding the same episode at the same path", () => {
		downloadedEpisodes.addEpisode(makeEpisode(), "Folder A/Recording.mp3", 10);
		expect(
			downloadedEpisodes.addEpisode(makeEpisode(), "Folder A/Recording.mp3", 11),
		).toBeUndefined();

		expect(get(downloadedEpisodes)["local file"]).toHaveLength(1);
	});

	it("returns undefined for a brand-new episode", () => {
		expect(
			downloadedEpisodes.addEpisode(makeEpisode(), "Folder A/Recording.mp3", 10),
		).toBeUndefined();
	});
});
