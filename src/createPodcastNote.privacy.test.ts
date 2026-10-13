// @vitest-environment jsdom
import { SecretStorage, TFile } from "obsidian";
import { afterEach, expect, test } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import { createPodcastNoteFileIfNotExists } from "./createPodcastNote";
import { FeedUrlRepository } from "./services/FeedUrlRepository";
import FeedDocumentParser from "./parser/feedDocumentParser";
import { plugin } from "./store";
import {
	FeedFilePathTemplateEngine,
	FeedNoteTemplateEngine,
	NoteTemplateEngine,
	TranscriptTemplateEngine,
} from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import buildEpisodeResumeLink from "./utility/buildEpisodeResumeLink";
import { formatEpisodeTimestamp } from "./utility/formatEpisodeTimestamp";

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

function noteVault(subscribed: boolean, artworkUrl = "") {
	const written: Array<{ path: string; content: string }> = [];
	const feedUrls = new FeedUrlRepository(new SecretStorage());
	const urlSecretId = feedUrls.store(address);
	plugin.set({
		feedUrls,
		settings: {
			...structuredClone(DEFAULT_SETTINGS),
			savedFeeds: subscribed
				? { Paid: { title: "Paid", url: placeholder, urlSecretId, artworkUrl } }
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
	expect(written[0].content).toContain(
		"[Resume in PodNotes](obsidian://podnotes?episodeName=Private%20episode&url=podnotes-private-feed%3APaid&guid=episode-1)",
	);
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

test.each([
	["title", { title: `Feed ${address}` }, "PodNotes/Paid/Feed podnotes-private-feedPaid.md"],
	["GUID", { guid: `${address}#1` }, "PodNotes/Paid/Private episode.md"],
])(
	"an episode whose %s quotes a subscribed feed gets no link or identity",
	async (_, quoting, path) => {
		const written = noteVault(true);
		const quoted: Episode = { ...episode, feedUrl: placeholder, ...quoting };
		expect(formatEpisodeTimestamp(quoted, 65, "HH:mm:ss", true)).toBe("00:01:05");
		expect(formatEpisodeTimestamp(quoted, 65, "HH:mm:ss", true, 70)).toBe("00:01:05-00:01:10");
		expect(buildEpisodeResumeLink(quoted)).toBe("");
		await createPodcastNoteFileIfNotExists(quoted);
		expect(written).toHaveLength(1);
		expect(written[0].path).toBe(path);
		expect(written[0].content).toContain("[Resume in PodNotes]()");
		expect(written[0].content).not.toMatch(/^(guid|feedUrl):/m);
		expect(written[0].content).not.toContain("NOTE_SENTINEL");
	},
);

test.each([`Your feed: ${address.replace("_", "&#95;")}`, `Your feed: &lt;${address}&gt;`])(
	"a description that spells a subscribed feed with entities is redacted: %s",
	async (html) => {
		const written = noteVault(true);
		const rss = `<rss><channel><title>Paid</title><item><title>Private episode</title><enclosure url="${episode.streamUrl}"/><description><![CDATA[<p>${html}</p>]]></description></item></channel></rss>`;
		const [item] = new FeedDocumentParser().parseEpisodes(rss).episodes;
		await createPodcastNoteFileIfNotExists({
			...item,
			url: episode.url,
			podcastName: "Paid",
			feedUrl: placeholder,
		});
		expect(written).toHaveLength(1);
		expect(written[0].content).toContain("Your feed: ");
		expect(written[0].content).toContain("podnotes-private-feed:Paid");
		expect(written[0].content).not.toContain("NOTE_SENTINEL");
	},
);

test.each([
	[address, ""],
	[
		"https://cdn.example.com/art.jpg?token=ART_SIGNATURE",
		"https://cdn.example.com/art.jpg?token=ART_SIGNATURE",
	],
])("{{feedartwork}} for saved artwork %s renders %j", (artworkUrl, expected) => {
	noteVault(true, artworkUrl);
	expect(NoteTemplateEngine("{{feedartwork}}", { ...episode, feedUrl: placeholder })).toBe(
		expected,
	);
});

test("a template that quotes a subscribed feed renders its placeholder", () => {
	noteVault(true);
	expect(
		NoteTemplateEngine(`Feed: ${address}\n{{title}}`, { ...episode, feedUrl: placeholder }),
	).toBe("Feed: podnotes-private-feed:Paid\nPrivate episode");
});

test("chapters and transcripts that quote a subscribed feed render its placeholder", () => {
	noteVault(true);
	const quoted = `Your feed: ${address}.`;
	const chapters = [{ startTime: 0, title: quoted }];
	expect(NoteTemplateEngine("{{chapters}}", episode, { chapters })).toBe(
		"- 0:00 Your feed: podnotes\\-private\\-feed:Paid\\.",
	);
	expect(TranscriptTemplateEngine("{{transcript}}", episode, quoted)).toBe(
		"Your feed: podnotes-private-feed:Paid.",
	);
});

test("a feed note for an unsubscribed private feed writes no feed address", () => {
	noteVault(false);
	const feed = {
		title: "Paid",
		url: address,
		artworkUrl: "",
		description: `Your feed: ${address}.`,
	};
	expect(FeedNoteTemplateEngine("{{feedurl}}|{{description}}", feed)).toBe(
		"|Your feed: podnotes-private-feed:.",
	);
	expect(FeedFilePathTemplateEngine("{{title}}", { ...feed, title: `Paid ${address}` })).toBe(
		"Paid podnotes-private-feed",
	);
});
