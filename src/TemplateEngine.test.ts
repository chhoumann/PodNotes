import { describe, expect, it } from "vitest";
import {
	DownloadPathTemplateEngine,
	FeedFilePathTemplateEngine,
	FeedNoteTemplateEngine,
	NoteTemplateEngine,
	getFeedNoteWikilink,
} from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import type { PodcastFeed } from "./types/PodcastFeed";
import { plugin } from "./store";

// The illegal-character sanitizer is private; exercise it through
// DownloadPathTemplateEngine, which applies it to {{title}} and {{podcast}}.
function sanitizeTitle(title: string): string {
	const episode = {
		title,
		streamUrl: "https://example.com/a.mp3",
		url: "https://example.com",
		description: "",
		content: "",
		podcastName: "Pod",
		episodeDate: undefined,
		artworkUrl: "",
	} as unknown as Episode;

	return DownloadPathTemplateEngine("{{title}}", episode);
}

describe("replaceIllegalFileNameCharactersInString (via DownloadPathTemplateEngine)", () => {
	it("preserves dots in titles (no more 'Episode 1.5' -> 'Episode 15')", () => {
		expect(sanitizeTitle("Episode 1.5")).toBe("Episode 1.5");
	});

	it("still strips filesystem-illegal and wikilink-hostile characters", () => {
		expect(sanitizeTitle('a/b\\c:d*e?f"g<h>i|j')).toBe("abcdefghij");
		expect(sanitizeTitle("a#b%c&d{e}f")).toBe("abcdef");
	});

	it("replaces every control character with a space (global), not just the first", () => {
		expect(sanitizeTitle("a\nb\nc")).toBe("a b c");
		expect(sanitizeTitle("a\tb\rc")).toBe("a b c");
	});

	it("collapses every run of whitespace, not just the first", () => {
		expect(sanitizeTitle("a  b  c")).toBe("a b c");
	});

	it("drops leading and trailing dots", () => {
		expect(sanitizeTitle("...hidden")).toBe("hidden");
		expect(sanitizeTitle("trailing...")).toBe("trailing");
	});

	it("does not strip hyphens or ordinary letters", () => {
		expect(sanitizeTitle("Part 1 - The Beginning")).toBe(
			"Part 1 - The Beginning",
		);
	});
});

const demoEpisode: Episode = {
	title: "Episode 1",
	streamUrl: "https://example.com/ep1.mp3",
	url: "https://example.com/ep1",
	description: "",
	content: "",
	podcastName: "My Show",
	feedUrl: "https://example.com/feed.xml",
	artworkUrl: "https://example.com/ep1.png",
	episodeDate: new Date("2024-01-01"),
};

describe("NoteTemplateEngine feed-scoped tags (#163)", () => {
	it("keeps {{url}} and {{artwork}} pointing at the episode itself", () => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		expect(NoteTemplateEngine("{{url}}|{{artwork}}", demoEpisode)).toBe(
			"https://example.com/ep1|https://example.com/ep1.png",
		);
	});

	it("adds episode aliases and {{feedurl}}", () => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		expect(NoteTemplateEngine("{{episodeurl}}", demoEpisode)).toBe(
			"https://example.com/ep1",
		);
		expect(NoteTemplateEngine("{{episodeartwork}}", demoEpisode)).toBe(
			"https://example.com/ep1.png",
		);
		expect(NoteTemplateEngine("{{feedurl}}", demoEpisode)).toBe(
			"https://example.com/feed.xml",
		);
	});

	it("resolves {{feedartwork}} from the saved feed, else the episode art", () => {
		plugin.set({
			settings: {
				feedNote: { path: "" },
				savedFeeds: {
					"My Show": {
						title: "My Show",
						url: "x",
						artworkUrl: "https://example.com/feed.png",
					},
				},
			},
		} as never);
		expect(NoteTemplateEngine("{{feedartwork}}", demoEpisode)).toBe(
			"https://example.com/feed.png",
		);

		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		expect(NoteTemplateEngine("{{feedartwork}}", demoEpisode)).toBe(
			"https://example.com/ep1.png",
		);
	});

	it("emits {{podcastlink}} as a path-qualified wikilink to the feed note", () => {
		plugin.set({
			settings: {
				feedNote: { path: "PodNotes/Podcasts/{{podcast}}.md" },
				savedFeeds: {},
			},
		} as never);
		expect(NoteTemplateEngine("{{podcastlink}}", demoEpisode)).toBe(
			"[[PodNotes/Podcasts/My Show|My Show]]",
		);
	});
});

describe("FeedNoteTemplateEngine (#163)", () => {
	const feed: PodcastFeed = {
		title: "My Show: A Podcast",
		url: "https://example.com/feed.xml",
		artworkUrl: "https://example.com/art.png",
		link: "https://example.com",
		description: "<p>Great show</p>",
		author: "Jane Doe",
	};

	it("maps {{url}}/{{artwork}} to the feed and exposes feed metadata", () => {
		expect(FeedNoteTemplateEngine("{{url}}", feed)).toBe("https://example.com");
		expect(FeedNoteTemplateEngine("{{feedurl}}", feed)).toBe(
			"https://example.com/feed.xml",
		);
		expect(FeedNoteTemplateEngine("{{artwork}}", feed)).toBe(
			"https://example.com/art.png",
		);
		expect(FeedNoteTemplateEngine("{{feedartwork}}", feed)).toBe(
			"https://example.com/art.png",
		);
		expect(FeedNoteTemplateEngine("{{author}}", feed)).toBe("Jane Doe");
		// htmlToMarkdown is a passthrough in the test mock.
		expect(FeedNoteTemplateEngine("{{description}}", feed)).toBe("<p>Great show</p>");
	});

	it("exposes raw {{title}} and sanitized {{podcast}}/{{safetitle}}", () => {
		expect(FeedNoteTemplateEngine("{{title}}", feed)).toBe("My Show: A Podcast");
		expect(FeedNoteTemplateEngine("{{podcast}}", feed)).toBe("My Show A Podcast");
		expect(FeedNoteTemplateEngine("{{safetitle}}", feed)).toBe("My Show A Podcast");
	});

	it("leaves {{url}} empty when the feed has no website link", () => {
		expect(FeedNoteTemplateEngine("{{url}}", { ...feed, link: undefined })).toBe("");
	});

	it("strips quote/backslash from URL tags so quoted YAML frontmatter stays valid", () => {
		const malformed: PodcastFeed = {
			...feed,
			link: 'https://example.com/a?x="b"\\c',
			artworkUrl: 'https://example.com/art".png',
		};
		expect(FeedNoteTemplateEngine("{{url}}", malformed)).toBe(
			"https://example.com/a?x=bc",
		);
		expect(FeedNoteTemplateEngine("{{artwork}}", malformed)).toBe(
			"https://example.com/art.png",
		);
	});
});

describe("FeedFilePathTemplateEngine (#163)", () => {
	const feed: PodcastFeed = {
		title: "My Show: A Podcast",
		url: "u",
		artworkUrl: "",
	};

	it("sanitizes the feed title for {{podcast}} and {{title}}", () => {
		expect(
			FeedFilePathTemplateEngine("PodNotes/Podcasts/{{podcast}}.md", feed),
		).toBe("PodNotes/Podcasts/My Show A Podcast.md");
	});

	it("supports a whitespace-replacement argument", () => {
		expect(FeedFilePathTemplateEngine("{{podcast:-}}", feed)).toBe(
			"My-Show-A-Podcast",
		);
	});
});

describe("getFeedNoteWikilink (#163)", () => {
	it("path-qualifies the link when the feed-note path has a folder", () => {
		plugin.set({
			settings: { feedNote: { path: "PodNotes/Podcasts/{{podcast}}.md" } },
		} as never);
		expect(getFeedNoteWikilink("My Show: A Podcast")).toBe(
			"[[PodNotes/Podcasts/My Show A Podcast|My Show A Podcast]]",
		);
	});

	it("uses a plain wikilink when the feed-note path has no folder", () => {
		plugin.set({
			settings: { feedNote: { path: "{{podcast}}.md" } },
		} as never);
		expect(getFeedNoteWikilink("My Show: A Podcast")).toBe(
			"[[My Show A Podcast]]",
		);
	});

	it("falls back to a plain sanitized link when no path is configured", () => {
		plugin.set({ settings: { feedNote: { path: "" } } } as never);
		expect(getFeedNoteWikilink("My Show: A Podcast")).toBe("[[My Show A Podcast]]");
	});
});
