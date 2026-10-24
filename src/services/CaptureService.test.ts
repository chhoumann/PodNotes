import { SecretStorage } from "obsidian";
import { afterEach, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { plugin } from "src/store";
import type { Episode } from "src/types/Episode";
import { quickAddVariables } from "./CaptureService";
import { FeedUrlRepository } from "./FeedUrlRepository";

const address = "https://private.example.com/rss?auth=NOTE_SENTINEL";
const placeholder = "podnotes-private-feed:Paid";

const publicEpisode: Episode = {
	title: "Saved Episode",
	podcastName: "Pod",
	feedUrl: "https://example.com/feed.xml",
	guid: "saved-1",
	url: "https://example.com/episodes/saved (1)",
	streamUrl: "https://example.com/saved.mp3",
	description: "",
	content: "",
};

const privateEpisode: Episode = {
	title: "Private episode",
	podcastName: "Paid",
	feedUrl: address,
	guid: "episode-1",
	url: "https://private.example.com/episode?token=EPISODE_TOKEN",
	streamUrl: "https://private.example.com/audio.mp3?token=MEDIA_SIGNATURE",
	description: `Your feed: ${address}.`,
	content: "",
};

function library(subscribed: boolean) {
	const feedUrls = new FeedUrlRepository(new SecretStorage());
	const urlSecretId = feedUrls.store(address);
	plugin.set({
		feedUrls,
		settings: {
			...structuredClone(DEFAULT_SETTINGS),
			savedFeeds: subscribed
				? { Paid: { title: "Paid", url: placeholder, urlSecretId, artworkUrl: "" } }
				: {},
		},
	} as never);
}

afterEach(() => plugin.set(undefined as never));

test("a moment gives QuickAdd its text, position, link and episode", () => {
	library(false);
	expect(quickAddVariables(publicEpisode, { text: "- 01:02:03 ", start: 3723.5 })).toEqual({
		timestamp: "- 01:02:03 ",
		time: "1:02:03",
		seconds: "3723",
		link: "obsidian://podnotes?episodeName=Saved%20Episode&url=https%3A%2F%2Fexample.com%2Ffeed.xml&guid=saved-1&time=3723.5",
		episode: "Saved Episode",
		podcast: "Pod",
		url: "https://example.com/episodes/saved%20%281%29",
		episodeNote: "PodNotes/Pod/Saved Episode.md",
	});
});

test("a segment gives QuickAdd its range", () => {
	library(false);
	expect(
		quickAddVariables(publicEpisode, {
			text: "- 01:01:53-01:02:03 ",
			start: 3713.5,
			end: 3723.5,
		}),
	).toEqual({
		timestamp: "- 01:01:53-01:02:03 ",
		time: "1:01:53-1:02:03",
		seconds: "3713",
		link: "obsidian://podnotes?episodeName=Saved%20Episode&url=https%3A%2F%2Fexample.com%2Ffeed.xml&guid=saved-1&time=3713.5&endTime=3723.5",
		episode: "Saved Episode",
		podcast: "Pod",
		url: "https://example.com/episodes/saved%20%281%29",
		episodeNote: "PodNotes/Pod/Saved Episode.md",
	});
});

test("a subscribed private feed links by its placeholder", () => {
	library(true);
	expect(
		quickAddVariables(
			{ ...privateEpisode, feedUrl: placeholder },
			{ text: "- 1:05", start: 65 },
		),
	).toEqual({
		timestamp: "- 1:05",
		time: "1:05",
		seconds: "65",
		link: "obsidian://podnotes?episodeName=Private%20episode&url=podnotes-private-feed%3APaid&guid=episode-1&time=65",
		episode: "Private episode",
		podcast: "Paid",
		url: "https://private.example.com/episode?token=EPISODE_TOKEN",
		episodeNote: "PodNotes/Paid/Private episode.md",
	});
});

test.each([
	["subscribed", true, placeholder],
	["unsubscribed", false, address],
])("a %s private feed's address is in no value", (_, subscribed, feedUrl) => {
	library(subscribed);
	const quoting: Episode = {
		...privateEpisode,
		feedUrl,
		title: `Feed ${address}`,
		url: `${address}"`,
	};
	expect(
		quickAddVariables(quoting, { text: `- 1:05 from ${address}`, start: 65, end: 70 }),
	).toEqual({
		timestamp: "- 1:05 from podnotes-private-feed:Paid",
		time: "1:05-1:10",
		seconds: "65",
		link: "",
		episode: "Feed podnotes-private-feed:Paid",
		podcast: "Paid",
		url: "podnotes-private-feed:Paid%22",
		episodeNote: "PodNotes/Paid/Feed podnotes-private-feedPaid.md",
	});
});
