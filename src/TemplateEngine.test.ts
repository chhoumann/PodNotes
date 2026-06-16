import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DownloadPathTemplateEngine,
	FeedFilePathTemplateEngine,
	FeedNoteTemplateEngine,
	FilePathTemplateEngine,
	NoteTemplateEngine,
	TranscriptTemplateEngine,
	getFeedNoteWikilink,
} from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import type { PodcastFeed } from "./types/PodcastFeed";
import { downloadedEpisodes, plugin } from "./store";
import { DEFAULT_SETTINGS } from "./constants";

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

	it("emits {{episodelink}} as a no-timestamp obsidian://podnotes link to the episode (#35)", () => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		downloadedEpisodes.set({});

		const rendered = NoteTemplateEngine("{{episodelink}}", demoEpisode);
		const parsed = new URL(rendered);

		expect(parsed.protocol).toBe("obsidian:");
		expect(parsed.host).toBe("podnotes");
		expect(parsed.searchParams.get("episodeName")).toBe("Episode 1");
		expect(parsed.searchParams.get("url")).toBe("https://example.com/feed.xml");
		// No baked-in time: the resume point is resolved when the link is clicked.
		expect(parsed.searchParams.has("time")).toBe(false);
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

describe("NoteTemplateEngine renders URL tags verbatim (#160 review)", () => {
	beforeEach(() => {
		plugin.set({
			settings: { feedNote: { path: "" }, savedFeeds: {} },
		} as never);
	});

	it("does not mutate {{url}}/{{episodeurl}} — local-file wikilinks pass through", () => {
		// For local-file episodes episode.url is a wikilink, not a URL
		// (getContextMenuHandler stores generateMarkdownLink). The engine must not
		// strip characters from it, or the link would point at a different file.
		const localFile = {
			...demoEpisode,
			url: '[[Talk "A".mp3]]',
		} as Episode;
		expect(NoteTemplateEngine("{{url}}", localFile)).toBe('[[Talk "A".mp3]]');
		expect(NoteTemplateEngine("{{episodeurl}}", localFile)).toBe(
			'[[Talk "A".mp3]]',
		);
	});

	it("renders a normal episode URL and artwork verbatim", () => {
		expect(NoteTemplateEngine("{{url}}|{{artwork}}", demoEpisode)).toBe(
			"https://example.com/ep1|https://example.com/ep1.png",
		);
	});
});

describe("default note template renders valid frontmatter (#160)", () => {
	beforeEach(() => {
		plugin.set({
			settings: {
				feedNote: { path: "PodNotes/Podcasts/{{podcast}}.md" },
				savedFeeds: {},
			},
		} as never);
		downloadedEpisodes.set({});
	});

	function frontmatterOf(rendered: string): string {
		const match = rendered.match(/^---\n([\s\S]*?)\n---\n/);
		expect(match).not.toBeNull();
		return (match as RegExpMatchArray)[1];
	}

	it("keeps frontmatter valid even when title/url carry YAML-hostile characters", () => {
		// A local-file episode whose name contains a quote is the worst case: the
		// title carries quotes/colons and {{url}} is a wikilink containing a quote.
		// Both must stay in the BODY (never a quoted frontmatter scalar) so the
		// frontmatter always parses. See issue #160 review.
		const episode: Episode = {
			...demoEpisode,
			title: 'Why "AI": a deep dive: part 2',
			url: '[[Audio/Talk "A".mp3]]',
			podcastName: "My Show",
		};
		const rendered = NoteTemplateEngine(
			DEFAULT_SETTINGS.note.template,
			episode,
		);
		const frontmatter = frontmatterOf(rendered);
		const line = (key: string) =>
			frontmatter.split("\n").find((l) => l.startsWith(`${key}:`));

		// The podcast link is quoted so its leading [[ isn't read as a flow sequence.
		expect(line("podcast")).toBe(
			'podcast: "[[PodNotes/Podcasts/My Show|My Show]]"',
		);
		// The url is NOT in the frontmatter (it could carry a quote for local files).
		expect(line("url")).toBeUndefined();
		// Every frontmatter line has balanced double-quotes.
		for (const l of frontmatter.split("\n")) {
			expect((l.match(/"/g) ?? []).length % 2).toBe(0);
		}
		// The raw title (quotes/colons) and the raw url (a quote-bearing wikilink)
		// live only in the body, where YAML rules don't apply.
		const body = rendered.slice(rendered.indexOf("\n---\n") + 5);
		expect(body).toContain('# Why "AI": a deep dive: part 2');
		expect(body).toContain('[[Audio/Talk "A".mp3]]');
		expect(frontmatter).not.toContain("deep dive");
		expect(frontmatter).not.toContain("Talk");
	});

	it("renders an ISO date when present and an empty (null) date otherwise", () => {
		const withDate = NoteTemplateEngine(
			DEFAULT_SETTINGS.note.template,
			demoEpisode,
		);
		expect(
			withDate.split("\n").find((l) => l.startsWith("date:")),
		).toBe("date: 2024-01-01");

		const noDate = NoteTemplateEngine(DEFAULT_SETTINGS.note.template, {
			...demoEpisode,
			episodeDate: undefined,
		});
		const dateLine = noDate.split("\n").find((l) => l.startsWith("date:"));
		// Empty publish date renders as a null property, never a broken value.
		expect(dateLine?.replace(/\s+$/, "")).toBe("date:");
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

	it("caps a long feed title so the link matches the capped feed-note path (#22)", () => {
		plugin.set({
			settings: { feedNote: { path: "PodNotes/Podcasts/{{podcast}}.md" } },
		} as never);
		const link = getFeedNoteWikilink("Z".repeat(400));
		const linkPath = link
			.replace(/^\[\[/, "")
			.replace(/\]\]$/, "")
			.split("|")[0];
		const basename = linkPath.split("/").pop() ?? "";
		// Without the cap the link would embed all 400 chars and never resolve.
		expect(basename.length).toBeLessThanOrEqual(255);
		expect(basename.length).toBeLessThan(400);
		expect(linkPath.startsWith("PodNotes/Podcasts/")).toBe(true);
	});
});

describe("{{currentDate}} tag (#75)", () => {
	beforeEach(() => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		vi.useFakeTimers();
		// A creation date deliberately different from the episode publish date.
		vi.setSystemTime(new Date("2026-06-15T08:30:00"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders today's date, defaulting to YYYY-MM-DD", () => {
		expect(NoteTemplateEngine("{{currentDate}}", demoEpisode)).toBe("2026-06-15");
	});

	it("supports a Moment.js format and is distinct from the episode {{date}}", () => {
		expect(
			NoteTemplateEngine("{{currentDate:YYYY}} vs {{date:YYYY}}", demoEpisode),
		).toBe("2026 vs 2024");
	});

	it("supports a format containing commas (not truncated by the engine)", () => {
		expect(
			NoteTemplateEngine("{{currentDate:MMMM D, YYYY}}", demoEpisode),
		).toBe("June 15, 2026");
	});

	it("is available in file-path and download-path templates", () => {
		expect(FilePathTemplateEngine("{{currentDate}}", demoEpisode)).toBe(
			"2026-06-15",
		);
		expect(DownloadPathTemplateEngine("{{currentDate}}", demoEpisode)).toBe(
			"2026-06-15",
		);
	});
});

describe("{{episodeNumber}} tag (#34)", () => {
	const numbered: Episode = { ...demoEpisode, episodeNumber: 42 };

	beforeEach(() => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
	});

	it("renders the episode number", () => {
		expect(NoteTemplateEngine("{{episodeNumber}}", numbered)).toBe("42");
	});

	it("zero-pads when given an all-zeros width", () => {
		expect(NoteTemplateEngine("{{episodeNumber:000}}", numbered)).toBe("042");
	});

	it("renders a stored episode number of 0 (not treated as absent)", () => {
		const ep0: Episode = { ...demoEpisode, episodeNumber: 0 };
		expect(NoteTemplateEngine("{{episodeNumber}}", ep0)).toBe("0");
	});

	it("falls back to the title when no number is stored (e.g. persisted episodes)", () => {
		const titleOnly: Episode = { ...demoEpisode, title: "#7 Lucky Seven" };
		expect(NoteTemplateEngine("{{episodeNumber}}", titleOnly)).toBe("7");
	});

	it("renders empty when neither the field nor the title has a number", () => {
		const noNumber: Episode = { ...demoEpisode, title: "A Show With No Number" };
		expect(NoteTemplateEngine("{{episodeNumber}}", noNumber)).toBe("");
	});

	it("is available (and file-safe) in file-path and download-path templates", () => {
		expect(
			FilePathTemplateEngine("{{episodeNumber:000}} {{title}}", numbered),
		).toBe("042 Episode 1");
		expect(
			DownloadPathTemplateEngine("{{episodeNumber:000}} {{title}}", numbered),
		).toBe("042 Episode 1");
	});
});

describe("{{duration}} tag (#88)", () => {
	// 1h 02m 03s.
	const withDuration: Episode = { ...demoEpisode, duration: 3723 };

	beforeEach(() => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
	});

	it("renders a human clock by default", () => {
		expect(NoteTemplateEngine("{{duration}}", withDuration)).toBe("1:02:03");
	});

	it("supports the minutes and seconds keywords", () => {
		expect(NoteTemplateEngine("{{duration:minutes}}", withDuration)).toBe("62");
		expect(NoteTemplateEngine("{{duration:seconds}}", withDuration)).toBe("3723");
	});

	it("supports a Moment.js clock format", () => {
		expect(NoteTemplateEngine("{{duration:HH:mm:ss}}", withDuration)).toBe(
			"01:02:03",
		);
	});

	it("renders a zero duration as 0:00 (not empty)", () => {
		const zero: Episode = { ...demoEpisode, duration: 0 };
		expect(NoteTemplateEngine("{{duration}}", zero)).toBe("0:00");
	});

	it("renders empty when the episode has no duration", () => {
		expect(NoteTemplateEngine("{{duration}}", demoEpisode)).toBe("");
	});

	it("is not registered in file-path/download-path templates (left unreplaced)", () => {
		// Intentionally absent there — the clock format's colons are path-illegal.
		expect(FilePathTemplateEngine("{{duration}}", withDuration)).toBe(
			"{{duration}}",
		);
		expect(DownloadPathTemplateEngine("{{duration}}", withDuration)).toBe(
			"{{duration}}",
		);
	});
});

describe("TranscriptTemplateEngine new tags (#75/#34/#88)", () => {
	const fixture: Episode = { ...demoEpisode, episodeNumber: 42, duration: 3723 };

	beforeEach(() => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-06-15T08:30:00"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders all three new tags in transcript notes", () => {
		expect(
			TranscriptTemplateEngine(
				"{{currentDate}}|{{episodeNumber:000}}|{{duration:minutes}}",
				fixture,
				"the transcript",
			),
		).toBe("2026-06-15|042|62");
	});

	it("leaves number/duration empty when absent", () => {
		const blank: Episode = { ...demoEpisode, title: "A Show With No Number" };
		expect(
			TranscriptTemplateEngine("[{{episodeNumber}}][{{duration}}]", blank, "t"),
		).toBe("[][]");
	});
});
