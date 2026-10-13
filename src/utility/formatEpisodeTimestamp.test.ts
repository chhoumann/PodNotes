import { describe, expect, test } from "vitest";
import type { Episode } from "src/types/Episode";
import { formatEpisodeTimestamp } from "./formatEpisodeTimestamp";

const episode: Episode = {
	title: "Pilot + Q&A",
	streamUrl: "https://pod.example.com/1.mp3",
	url: "",
	description: "",
	content: "",
	podcastName: "Feed Podcast",
	feedUrl: "https://pod.example.com/feed.xml",
};

describe("formatEpisodeTimestamp", () => {
	test("links the episode at the exact fractional second while showing the floored time", () => {
		expect(formatEpisodeTimestamp(episode, 3725.48, "HH:mm:ss", true)).toBe(
			"[01:02:05](obsidian://podnotes?episodeName=Pilot%20%2B%20Q%26A&url=https%3A%2F%2Fpod.example.com%2Ffeed.xml&time=3725.48)",
		);
	});

	test("renders the plain time without linkify", () => {
		expect(formatEpisodeTimestamp(episode, 65.9, "mm:ss", false)).toBe("01:05");
	});

	test("renders the plain time for a private feed this device has not saved", () => {
		const feedUrl = "https://pod.example.com/feed.xml?auth=TIMESTAMP_SENTINEL";
		expect(formatEpisodeTimestamp({ ...episode, feedUrl }, 65, "HH:mm:ss", true)).toBe(
			"00:01:05",
		);
		expect(formatEpisodeTimestamp({ ...episode, feedUrl }, 65, "HH:mm:ss", true, 70)).toBe(
			"00:01:05-00:01:10",
		);
	});

	test("links a saved private feed by its placeholder", () => {
		expect(
			formatEpisodeTimestamp(
				{ ...episode, feedUrl: "podnotes-private-feed:Feed%20Podcast" },
				65,
				"HH:mm:ss",
				true,
			),
		).toBe(
			"[00:01:05](obsidian://podnotes?episodeName=Pilot%20%2B%20Q%26A&url=podnotes-private-feed%3AFeed%2520Podcast&time=65)",
		);
	});

	test("renders the plain time for an episode PodNotes cannot link to", () => {
		expect(
			formatEpisodeTimestamp({ ...episode, feedUrl: undefined }, 65, "HH:mm:ss", true),
		).toBe("00:01:05");
	});
});
