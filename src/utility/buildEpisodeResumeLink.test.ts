import { afterEach, beforeEach, describe, expect, test } from "vitest";
import buildEpisodeResumeLink from "./buildEpisodeResumeLink";
import { downloadedEpisodes } from "src/store";
import type { Episode } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";

const remoteEpisode: Episode = {
	title: "Episode 1",
	streamUrl: "https://pod.example.com/ep1.mp3",
	url: "https://pod.example.com/ep1",
	description: "",
	content: "",
	podcastName: "My Show",
	feedUrl: "https://pod.example.com/feed.xml",
};

function resetDownloaded() {
	downloadedEpisodes.set({});
}

describe("buildEpisodeResumeLink (#35)", () => {
	beforeEach(resetDownloaded);
	afterEach(resetDownloaded);

	test("addresses a streamed episode by its feed URL and carries no timestamp", () => {
		const link = buildEpisodeResumeLink(remoteEpisode);
		const parsed = new URL(link);

		expect(parsed.protocol).toBe("obsidian:");
		expect(parsed.host).toBe("podnotes");
		expect(parsed.searchParams.get("episodeName")).toBe("Episode 1");
		expect(parsed.searchParams.get("url")).toBe(
			"https://pod.example.com/feed.xml",
		);
		// No time => URIHandler resumes from the last played location.
		expect(parsed.searchParams.has("time")).toBe(false);
	});

	test("addresses a local-file episode by its own file path", () => {
		const localEpisode: LocalEpisode = {
			title: "Field Notes",
			streamUrl: "Audio/Field Notes.mp3",
			url: "Audio/Field Notes.mp3",
			description: "",
			content: "",
			podcastName: "local file",
			filePath: "Audio/Field Notes.mp3",
		};

		const parsed = new URL(buildEpisodeResumeLink(localEpisode));

		expect(parsed.searchParams.get("url")).toBe("Audio/Field Notes.mp3");
		expect(parsed.searchParams.has("time")).toBe(false);
	});

	test("falls back to a downloaded local-file path when the episode lacks one", () => {
		const localEpisode = {
			title: "Field Notes",
			streamUrl: "",
			url: "",
			description: "",
			content: "",
			podcastName: "local file",
		} as LocalEpisode;
		downloadedEpisodes.addEpisode(localEpisode, "Downloads/Field Notes.mp3", 1);

		const parsed = new URL(buildEpisodeResumeLink(localEpisode));

		expect(parsed.searchParams.get("url")).toBe("Downloads/Field Notes.mp3");
	});

	test("addresses a downloaded non-local episode by its feed URL (not file path)", () => {
		downloadedEpisodes.addEpisode(remoteEpisode, "Downloads/ep1.mp3", 1);

		const parsed = new URL(buildEpisodeResumeLink(remoteEpisode));

		// A normal podcast episode resolves remotely; downloaded availability is the
		// player's concern, so the link still addresses it by feed URL.
		expect(parsed.searchParams.get("url")).toBe(
			"https://pod.example.com/feed.xml",
		);
	});

	test("falls back to a downloaded copy's path for a non-local episode with no feed URL", () => {
		// An older/imported snapshot can lack feedUrl; a downloaded copy still has a
		// usable vault path, so the link should work rather than degrade to "".
		const noFeed: Episode = { ...remoteEpisode, feedUrl: undefined };
		downloadedEpisodes.addEpisode(noFeed, "Downloads/ep1.mp3", 1);

		const parsed = new URL(buildEpisodeResumeLink(noFeed));

		expect(parsed.searchParams.get("url")).toBe("Downloads/ep1.mp3");
		expect(parsed.searchParams.has("time")).toBe(false);
	});

	test("returns an empty string when there is no feed URL or file path to address", () => {
		const orphan: Episode = { ...remoteEpisode, feedUrl: undefined };

		expect(buildEpisodeResumeLink(orphan)).toBe("");
	});

	test("percent-encodes a title containing a literal '+' so it round-trips", () => {
		const plus: Episode = { ...remoteEpisode, title: "Episode 50: C++ Tips" };

		const link = buildEpisodeResumeLink(plus);

		// Obsidian decodes with decodeURIComponent only; encodePodnotesURI emits
		// %2B (not '+') so the title decodes back to a literal '+'.
		expect(link).toContain("Episode%2050%3A%20C%2B%2B%20Tips");
		expect(new URL(link).searchParams.get("episodeName")).toBe(
			"Episode 50: C++ Tips",
		);
	});
});
