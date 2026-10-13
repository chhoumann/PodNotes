// @vitest-environment jsdom
import { SecretStorage, TFile } from "obsidian";
import { afterEach, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import { createPodcastNoteFileIfNotExists } from "./createPodcastNote";
import { FeedUrlRepository } from "./services/FeedUrlRepository";
import { plugin } from "./store";
import type { Episode } from "./types/Episode";
import buildEpisodeResumeLink from "./utility/buildEpisodeResumeLink";

const address = "https://private.example.com/rss?auth=NOTE_SENTINEL";
const placeholder = "podnotes-private-feed:Paid";
const episode: Episode = {
	title: "Private episode",
	podcastName: "Paid",
	feedUrl: address,
	guid: "episode-1",
	url: "https://private.example.com/episode?token=EPISODE_TOKEN",
	streamUrl: "https://private.example.com/audio.mp3?token=MEDIA_SIGNATURE",
	description: `Your feed: ${address}.`,
	content: "",
};

function noteVault(subscribed: boolean) {
	const written: Array<{ path: string; content: string }> = [];
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
		app: {
			vault: {
				getAbstractFileByPath: () => null,
				getMarkdownFiles: () => [],
				getRoot: () => null,
				createFolder: async () => {},
				create: async (path: string, content: string) => {
					written.push({ path, content });
					return Object.assign(new TFile(), { path });
				},
			},
			metadataCache: { getFileCache: () => null },
		},
	} as never);
	return written;
}

afterEach(() => plugin.set(undefined as never));

test.each([
	address,
	"https://private.example.com./rss?auth=NOTE_SENTINEL",
	"https:\\\\private.example.com/rss?auth=NOTE_SENTINEL",
])("a newly written note redacts a subscribed feed quoted as %s", async (quoted) => {
	const written = noteVault(true);
	await createPodcastNoteFileIfNotExists({
		...episode,
		feedUrl: placeholder,
		description: `Your feed: ${quoted}.`,
	});
	expect(written).toHaveLength(1);
	expect(written[0].content).toContain("Your feed: podnotes-private-feed:Paid.");
	expect(written[0].content).toContain(episode.url);
	expect(written[0].content).toContain('feedUrl: "podnotes-private-feed:Paid"');
	expect(written[0].content).not.toContain("NOTE_SENTINEL");
});

test("an unsubscribed private episode writes no feed address and keeps its live URL", async () => {
	const written = noteVault(false);
	await createPodcastNoteFileIfNotExists(episode);
	expect(written).toHaveLength(1);
	expect(written[0].content).toContain("# Private episode");
	expect(written[0].content).toContain(episode.url);
	expect(written[0].content).not.toContain("NOTE_SENTINEL");
	expect(written[0].content).not.toMatch(/^feedUrl:/m);
	expect(episode.feedUrl).toBe(address);
});

test.each([
	address,
	"https://user:API_SENTINEL@private.example.com/rss",
	"https://priv3.supercast.com/feeds/API_SENTINEL/feed.xml",
	"https://subscribers.transistor.fm/API_SENTINEL",
])("the public resume-link builder refuses an unsubscribed private feed: %s", (feedUrl) => {
	noteVault(false);
	expect(buildEpisodeResumeLink({ ...episode, feedUrl })).toBe("");
});
