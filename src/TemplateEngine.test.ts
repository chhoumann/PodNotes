import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	DownloadPathTemplateEngine,
	FeedFilePathTemplateEngine,
	FeedNoteTemplateEngine,
	FilePathTemplateEngine,
	NoteTemplateEngine,
	TimestampTemplateEngine,
	TranscriptTemplateEngine,
	getFeedNoteWikilink,
} from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import type { PodcastFeed } from "./types/PodcastFeed";
import { currentEpisode, currentTime, downloadedEpisodes, plugin } from "./store";
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

	it("strips square brackets so a feed title cannot inject a wikilink", () => {
		// '[' and ']' are wikilink-significant; a feed <title> must not be able to
		// smuggle a [[wikilink]] through a file-name/link tag (other-wikilink-injection).
		expect(sanitizeTitle("Real]] [[Victims Private Note")).toBe("Real Victims Private Note");
		expect(sanitizeTitle("a[b]c")).toBe("abc");
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
		expect(sanitizeTitle("Part 1 - The Beginning")).toBe("Part 1 - The Beginning");
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

describe("DownloadPathTemplateEngine extension stripping (#DL-04)", () => {
	it("strips only a trailing template extension", () => {
		expect(DownloadPathTemplateEngine("Podcasts/{{title}}.mp3", demoEpisode)).toBe(
			"Podcasts/Episode 1",
		);
	});

	it("does not corrupt a folder that contains the extension string earlier in the path", () => {
		// getUrlExtension returns the trailing 'mp3', but the old positional
		// `.replace('mp3', '')` would strip the FIRST 'mp3' (in the folder name),
		// mangling 'mp3folder' -> 'folder' and leaving the real '.mp3' behind.
		expect(DownloadPathTemplateEngine("mp3folder/{{title}}.mp3", demoEpisode)).toBe(
			"mp3folder/Episode 1",
		);
	});

	it("leaves a template without a trailing extension untouched", () => {
		expect(DownloadPathTemplateEngine("Podcasts/{{title}}", demoEpisode)).toBe(
			"Podcasts/Episode 1",
		);
	});
});

describe("TimestampTemplateEngine segment tags", () => {
	beforeEach(() => {
		currentEpisode.set(demoEpisode);
		currentTime.set(125);
		downloadedEpisodes.set({});
		plugin.set({
			settings: {
				timestamp: { offset: 0 },
			},
			api: {
				getPodcastTimeFormatted: (
					format: string,
					linkify: boolean,
					offsetSeconds: number,
				) => `time:${format}:${linkify ? "link" : "plain"}:${offsetSeconds}`,
				getPodcastSegmentFormatted: (
					format: string,
					startTime: number,
					endTime: number,
					linkify: boolean,
				) => `segment:${format}:${startTime}-${endTime}:${linkify ? "link" : "plain"}`,
			},
		} as never);
	});

	it("renders plain and linked segment ranges when segment context is provided", () => {
		expect(
			TimestampTemplateEngine("{{segment}} {{linksegment:mm:ss}}", {
				segment: { startTime: 115, endTime: 125 },
			}),
		).toBe("segment:HH:mm:ss:115-125:plain segment:mm:ss:115-125:link");
	});

	it("falls back to current time behavior when segment tags are used without segment context", () => {
		expect(TimestampTemplateEngine("{{segment}} {{linksegment}}")).toBe(
			"time:HH:mm:ss:plain:0 time:HH:mm:ss:link:0",
		);
	});
});

describe("empty tag arguments (NT-05/CH-09)", () => {
	it("treats {{date:}} as the default date, not an unknown tag", () => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		// A bare trailing colon must use the tag default (same as {{date}}),
		// not parse as tagId "date:" (invalid) and not pass "" as the format.
		expect(NoteTemplateEngine("{{date:}}", demoEpisode)).toBe(
			NoteTemplateEngine("{{date}}", demoEpisode),
		);
		expect(NoteTemplateEngine("{{date:}}", demoEpisode)).toBe("2024-01-01");
	});

	it("preserves a whitespace-only argument rather than collapsing it (no regression)", () => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		// A lone-space argument is passed through to the tag (formatDate(date, " ")),
		// keeping the obscure space-prepend usage working — only an empty arg defaults.
		expect(NoteTemplateEngine("{{date: }}", demoEpisode)).toBe(" ");
	});

	it("still honors a real date format argument", () => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		expect(NoteTemplateEngine("{{date:YYYY}}", demoEpisode)).toBe("2024");
	});

	it("renders a JSON-restored episode date without throwing", () => {
		const restoredEpisode = {
			...demoEpisode,
			episodeDate: "2024-01-01T00:00:00.000Z" as unknown as Date,
		};

		expect(NoteTemplateEngine("{{date:YYYY-MM-DD}}", restoredEpisode)).toBe("2024-01-01");
	});
});

describe("note-render hardening (browser-managed requests from generated notes)", () => {
	it("omits private and local resource targets from portable artwork tags", () => {
		for (const artworkUrl of [
			"http://127.0.0.1/private.png",
			"http://169.254.169.254/latest/meta-data/",
			"file:///Users/example/secret.png",
		]) {
			expect(NoteTemplateEngine("{{artwork}}", { ...demoEpisode, artworkUrl })).toBe("");
		}
	});

	it("omits credential-bearing artwork URLs (userinfo never reaches a note)", () => {
		expect(
			NoteTemplateEngine("{{artwork}}", {
				...demoEpisode,
				artworkUrl: "https://user:pass@example.com/art.png",
			}),
		).toBe("");
	});

	it("keeps ordinary public artwork URLs", () => {
		expect(
			NoteTemplateEngine("{{artwork}}", {
				...demoEpisode,
				artworkUrl: "https://cdn.example.com/art.png",
			}),
		).toBe("https://cdn.example.com/art.png");
	});

	it("removes active media elements from feed descriptions while preserving alt text", () => {
		const malicious: Episode = {
			...demoEpisode,
			description:
				'<p>Introduction <img src="http://127.0.0.1/private.png" alt="cover art"><iframe src="http://169.254.169.254/"></iframe></p>',
		};
		const rendered = NoteTemplateEngine("{{description}}", malicious);
		expect(rendered).toContain("Introduction");
		expect(rendered).toContain("cover art");
		expect(rendered).not.toContain("127.0.0.1");
		expect(rendered).not.toContain("169.254.169.254");
		expect(rendered).not.toContain("<img");
		expect(rendered).not.toContain("<iframe");
	});

	it("renders raw Markdown image and vault-embed syntax inert in feed text", () => {
		const malicious: Episode = {
			...demoEpisode,
			description:
				"![private](http://127.0.0.1/admin) ![[Secrets.md]] \\![metadata](http://169.254.169.254/)",
		};
		const rendered = NoteTemplateEngine("{{description}}", malicious);
		expect(rendered).not.toMatch(/(^|[^\\])!\[/);
		expect(rendered).toContain("private");
		expect(rendered).toContain("Secrets.md");
	});
});

describe("NoteTemplateEngine feed-scoped tags (#163)", () => {
	it("keeps {{url}} and {{artwork}} pointing at the episode itself", () => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		expect(NoteTemplateEngine("{{url}}|{{artwork}}", demoEpisode)).toBe(
			"https://example.com/ep1|https://example.com/ep1.png",
		);
	});

	it("adds episode aliases and {{feedurl}}", () => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
		expect(NoteTemplateEngine("{{episodeurl}}", demoEpisode)).toBe("https://example.com/ep1");
		expect(NoteTemplateEngine("{{episodeartwork}}", demoEpisode)).toBe(
			"https://example.com/ep1.png",
		);
		expect(NoteTemplateEngine("{{feedurl}}", demoEpisode)).toBe("https://example.com/feed.xml");
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
		// (getContextMenuHandler stores generateMarkdownLink, podcastName "local
		// file", and a plugin-set filePath). The engine must not strip characters
		// from a trusted vault link, or it would point at a different file.
		const localFile = {
			...demoEpisode,
			podcastName: "local file",
			filePath: 'Audio/Talk "A".mp3',
			url: '[[Talk "A".mp3]]',
		} as Episode;
		expect(NoteTemplateEngine("{{url}}", localFile)).toBe('[[Talk "A".mp3]]');
		expect(NoteTemplateEngine("{{episodeurl}}", localFile)).toBe('[[Talk "A".mp3]]');
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
		const episode = {
			...demoEpisode,
			title: 'Why "AI": a deep dive: part 2',
			url: '[[Audio/Talk "A".mp3]]',
			// A local-file episode (podcastName "local file" + plugin-set filePath) is
			// the only case where {{url}} is a trusted vault wikilink passed verbatim.
			podcastName: "local file",
			filePath: 'Audio/Talk "A".mp3',
		} as Episode;
		const rendered = NoteTemplateEngine(DEFAULT_SETTINGS.note.template, episode);
		const frontmatter = frontmatterOf(rendered);
		const line = (key: string) => frontmatter.split("\n").find((l) => l.startsWith(`${key}:`));

		// The podcast link is quoted so its leading [[ isn't read as a flow sequence.
		expect(line("podcast")).toBe('podcast: "[[PodNotes/Podcasts/local file|local file]]"');
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
		const withDate = NoteTemplateEngine(DEFAULT_SETTINGS.note.template, demoEpisode);
		expect(withDate.split("\n").find((l) => l.startsWith("date:"))).toBe("date: 2024-01-01");

		const noDate = NoteTemplateEngine(DEFAULT_SETTINGS.note.template, {
			...demoEpisode,
			episodeDate: undefined,
		});
		const dateLine = noDate.split("\n").find((l) => l.startsWith("date:"));
		// Empty publish date renders as a null property, never a broken value.
		expect(dateLine?.replace(/\s+$/, "")).toBe("date:");
	});

	it("keeps quote- and backslash-heavy titles in Markdown body context", () => {
		const episode: Episode = {
			...demoEpisode,
			title: 'A ""quoted"" \\[title\\]\nwith controls\u0000\u007f',
		};
		const rendered = NoteTemplateEngine(DEFAULT_SETTINGS.note.template, episode);
		const frontmatter = frontmatterOf(rendered);
		const body = rendered.slice(rendered.indexOf("\n---\n") + 5);

		// The default contract keeps raw metadata out of YAML, where Markdown
		// escaping would not protect a quoted scalar. Its body encoding preserves
		// the visible characters while collapsing the injected line break.
		expect(frontmatter).not.toContain("quoted");
		expect(frontmatter).not.toContain("title");
		expect(body).toContain(String.raw`# A ""quoted"" \\\[title\\\] with controls`);
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
		expect(FeedNoteTemplateEngine("{{feedurl}}", feed)).toBe("https://example.com/feed.xml");
		expect(FeedNoteTemplateEngine("{{artwork}}", feed)).toBe("https://example.com/art.png");
		expect(FeedNoteTemplateEngine("{{feedartwork}}", feed)).toBe("https://example.com/art.png");
		expect(FeedNoteTemplateEngine("{{author}}", feed)).toBe("Jane Doe");
		// htmlToMarkdown is a passthrough in the test mock.
		expect(FeedNoteTemplateEngine("{{description}}", feed)).toBe("<p>Great show</p>");
	});

	it("exposes raw {{title}} and sanitized {{podcast}}/{{safetitle}}", () => {
		expect(FeedNoteTemplateEngine("{{title}}", feed)).toBe("My Show: A Podcast");
		expect(FeedNoteTemplateEngine("{{podcast}}", feed)).toBe("My Show A Podcast");
		expect(FeedNoteTemplateEngine("{{safetitle}}", feed)).toBe("My Show A Podcast");
	});

	it("keeps the default line-leading author in plain Markdown text context", () => {
		const attacks = [
			["# forged heading", String.raw`\# forged heading`],
			["> forged quote", "&gt; forged quote"],
			["---", String.raw`\-\-\-`],
			["~~~dataviewjs", String.raw`\~\~\~dataviewjs`],
			["```dataviewjs", "\\`\\`\\`dataviewjs"],
		] as const;

		for (const [author, encodedAuthor] of attacks) {
			const rendered = FeedNoteTemplateEngine(DEFAULT_SETTINGS.feedNote.template, {
				...feed,
				author,
			});

			expect(rendered).toContain(`\n${encodedAuthor}\n\n`);
		}
	});

	it("leaves {{url}} empty when the feed has no website link", () => {
		expect(FeedNoteTemplateEngine("{{url}}", { ...feed, link: undefined })).toBe("");
	});

	it("percent-encodes quote/backslash in URL tags so quoted YAML frontmatter and Markdown targets stay valid", () => {
		const malformed: PodcastFeed = {
			...feed,
			link: 'https://example.com/a?x="b"\\c',
			artworkUrl: 'https://example.com/art".png',
		};
		// Encoded (not stripped) so the value stays a working URL while no raw quote
		// or backslash can terminate the quoted YAML scalar.
		expect(FeedNoteTemplateEngine("{{url}}", malformed)).toBe(
			"https://example.com/a?x=%22b%22%5Cc",
		);
		expect(FeedNoteTemplateEngine("{{artwork}}", malformed)).toBe(
			"https://example.com/art%22.png",
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
		expect(FeedFilePathTemplateEngine("PodNotes/Podcasts/{{podcast}}.md", feed)).toBe(
			"PodNotes/Podcasts/My Show A Podcast.md",
		);
	});

	it("supports a whitespace-replacement argument", () => {
		expect(FeedFilePathTemplateEngine("{{podcast:-}}", feed)).toBe("My-Show-A-Podcast");
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
		expect(getFeedNoteWikilink("My Show: A Podcast")).toBe("[[My Show A Podcast]]");
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
		const linkPath = link.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0];
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
		expect(NoteTemplateEngine("{{currentDate:YYYY}} vs {{date:YYYY}}", demoEpisode)).toBe(
			"2026 vs 2024",
		);
	});

	it("supports a format containing commas (not truncated by the engine)", () => {
		expect(NoteTemplateEngine("{{currentDate:MMMM D, YYYY}}", demoEpisode)).toBe(
			"June 15, 2026",
		);
	});

	it("is available in file-path and download-path templates", () => {
		expect(FilePathTemplateEngine("{{currentDate}}", demoEpisode)).toBe("2026-06-15");
		expect(DownloadPathTemplateEngine("{{currentDate}}", demoEpisode)).toBe("2026-06-15");
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
		expect(FilePathTemplateEngine("{{episodeNumber:000}} {{title}}", numbered)).toBe(
			"042 Episode 1",
		);
		expect(DownloadPathTemplateEngine("{{episodeNumber:000}} {{title}}", numbered)).toBe(
			"042 Episode 1",
		);
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
		expect(NoteTemplateEngine("{{duration:HH:mm:ss}}", withDuration)).toBe("01:02:03");
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
		expect(FilePathTemplateEngine("{{duration}}", withDuration)).toBe("{{duration}}");
		expect(DownloadPathTemplateEngine("{{duration}}", withDuration)).toBe("{{duration}}");
	});
});

describe("{{chapters}} tag (#47)", () => {
	const chapters = [
		{ startTime: 65, title: "Deep Dive" },
		{ startTime: 0, title: "  Intro\nSegment  " },
		{ startTime: 90, title: "Sponsor", toc: false },
	];

	beforeEach(() => {
		plugin.set({ settings: { feedNote: { path: "" }, savedFeeds: {} } } as never);
	});

	it("renders visible chapters as a sorted Markdown list", () => {
		expect(NoteTemplateEngine("{{chapters}}", demoEpisode, { chapters })).toBe(
			"- 0:00 Intro Segment\n- 1:05 Deep Dive",
		);
	});

	it("can prepend each rendered chapter line", () => {
		expect(NoteTemplateEngine("{{chapters:> }}", demoEpisode, { chapters })).toBe(
			"> - 0:00 Intro Segment\n> - 1:05 Deep Dive",
		);
	});

	it("escapes chapter titles so feed-controlled text cannot inject Markdown", () => {
		expect(
			NoteTemplateEngine("{{chapters}}", demoEpisode, {
				chapters: [
					{
						startTime: 0,
						title: "[click](obsidian://podnotes) ![pixel](https://example.com/pixel)",
					},
				],
			}),
		).toBe(
			"- 0:00 \\[click\\]\\(obsidian://podnotes\\) \\!\\[pixel\\]\\(https://example\\.com/pixel\\)",
		);
	});

	it("renders visible untitled chapters as timestamp-only entries", () => {
		expect(
			NoteTemplateEngine("{{chapters}}", demoEpisode, {
				chapters: [
					{ startTime: 35, title: "" },
					{ startTime: 65, title: "Deep Dive" },
				],
			}),
		).toBe("- 0:35\n- 1:05 Deep Dive");
	});

	it("renders empty when no chapters were fetched", () => {
		expect(NoteTemplateEngine("[{{chapters}}]", demoEpisode)).toBe("[]");
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
		expect(TranscriptTemplateEngine("[{{episodeNumber}}][{{duration}}]", blank, "t")).toBe(
			"[][]",
		);
	});
});

describe("feed content injection is neutralized (deepsec other-markdown-injection)", () => {
	beforeEach(() => {
		plugin.set({
			settings: {
				feedNote: { path: "PodNotes/Podcasts/{{podcast}}.md" },
				savedFeeds: {},
			},
		} as never);
		downloadedEpisodes.set({});
	});

	// The headline attack from the finding: a crafted artwork URL tries to break
	// out of the default template's `![]({{artwork}})` to inject extra external
	// images (tracking pixels) and links.
	it("prevents an artwork URL from breaking out of ![]() to inject images/links", () => {
		const malicious: Episode = {
			...demoEpisode,
			artworkUrl: "x)![pwn](http://attacker.example/leak.png) [click](http://phish)",
		};
		const rendered = NoteTemplateEngine("![]({{artwork}})", malicious);

		// Exactly one image, and the wrapping parens are the only parens left, so
		// nothing escaped the target. The attacker's image/link markdown is inert.
		expect((rendered.match(/!\[/g) ?? []).length).toBe(1);
		expect(rendered).toMatch(/^!\[\]\([^()]*\)$/);
		expect(rendered).not.toContain("](http://attacker.example/leak.png)");
		expect(rendered).not.toContain("[click](http://phish)");
	});

	it("neutralizes a feed {{url}}/{{stream}} that injects Markdown on a bare line", () => {
		const malicious: Episode = {
			...demoEpisode,
			podcastName: "Evil Pod", // not a local file -> feed-controlled URL
			url: "x](http://phish) [more](http://evil)",
			streamUrl: "x)![pwn](http://attacker.example/s.png)",
		};
		const url = NoteTemplateEngine("{{url}}", malicious);
		const stream = NoteTemplateEngine("{{stream}}", malicious);

		for (const value of [url, stream]) {
			// No raw Markdown link/image metacharacters survive to form a link/image.
			expect(value).not.toMatch(/[[\]()]/);
			expect(value).not.toContain("](");
		}
	});

	it("collapses newlines and neutralizes Markdown in a raw {{title}}", () => {
		const malicious: Episode = {
			...demoEpisode,
			title: "Real Title\n\n# Injected Heading\n\n![pixel](http://attacker.example/t.png)",
		};
		const rendered = NoteTemplateEngine("# {{title}}", malicious);

		// Stays a single line: the title can no longer inject extra blocks/headings.
		expect(rendered.split("\n")).toHaveLength(1);
		// The image marker is escaped so it cannot load an external (tracking) image.
		expect(rendered).not.toMatch(/!\[pixel\]\(/);
		expect(rendered).toContain("\\[pixel\\]");
	});

	it("does not let input backslashes reactivate escaped Markdown links", () => {
		const malicious: Episode = {
			...demoEpisode,
			// Each bracket arrives already preceded by a backslash. If the sanitizer
			// only prefixes the bracket, the resulting even-length backslash run
			// leaves that bracket active in CommonMark and recreates a live link.
			title: String.raw`\[click\](//attacker.example/phish)`,
		};

		expect(NoteTemplateEngine("{{title}}", malicious)).toBe(
			String.raw`\\\[click\\\]\(//attacker\.example/phish\)`,
		);
	});

	it("keeps every Markdown metacharacter escaped after any input backslash run", () => {
		const punctuation = [
			"`",
			"*",
			"_",
			"{",
			"}",
			"[",
			"]",
			"(",
			")",
			"#",
			"+",
			"-",
			".",
			"!",
			"|",
			"=",
			"~",
			"$",
			"%",
			"^",
		];

		for (const metacharacter of punctuation) {
			for (let inputBackslashes = 0; inputBackslashes <= 6; inputBackslashes += 1) {
				const inputPrefix = "\\".repeat(inputBackslashes);
				const expectedPrefix = "\\".repeat(inputBackslashes * 2 + 1);
				const episode: Episode = {
					...demoEpisode,
					title: `${inputPrefix}${metacharacter}text`,
				};

				expect(NoteTemplateEngine("{{title}}", episode)).toBe(
					`${expectedPrefix}${metacharacter}text`,
				);
			}
		}
	});

	it("neutralizes line-leading CommonMark and Obsidian block markers", () => {
		const attacks = [
			["# forged heading", String.raw`\# forged heading`],
			["> forged quote", "&gt; forged quote"],
			["- forged list", String.raw`\- forged list`],
			["+ forged list", String.raw`\+ forged list`],
			["1. forged list", String.raw`1\. forged list`],
			["1) forged list", String.raw`1\) forged list`],
			["---", String.raw`\-\-\-`],
			["***", String.raw`\*\*\*`],
			["___", String.raw`\_\_\_`],
			["===", String.raw`\=\=\=`],
			["~~~dataviewjs", String.raw`\~\~\~dataviewjs`],
			["```dataviewjs", "\\`\\`\\`dataviewjs"],
			["<script>alert(1)</script>", "&lt;script&gt;alert\\(1\\)&lt;/script&gt;"],
		] as const;

		for (const [title, encodedTitle] of attacks) {
			expect(NoteTemplateEngine("{{title}}\n", { ...demoEpisode, title })).toBe(
				`${encodedTitle}\n`,
			);
		}
	});

	it("encodes ampersands before angle entities so entity-looking input stays literal", () => {
		const episode: Episode = {
			...demoEpisode,
			title: "Fish & chips <b>bold</b> &lt; &#35;",
		};

		expect(NoteTemplateEngine("{{title}}", episode)).toBe(
			String.raw`Fish &amp; chips &lt;b&gt;bold&lt;/b&gt; &amp;lt; &amp;\#35;`,
		);
	});

	it("preserves repeated input backslashes before ampersands and angle brackets", () => {
		for (const [character, entity] of [
			["&", "&amp;"],
			["<", "&lt;"],
			[">", "&gt;"],
		] as const) {
			for (let inputBackslashes = 0; inputBackslashes <= 6; inputBackslashes += 1) {
				const episode: Episode = {
					...demoEpisode,
					title: `${"\\".repeat(inputBackslashes)}${character}text`,
				};

				expect(NoteTemplateEngine("{{title}}", episode)).toBe(
					`${"\\".repeat(inputBackslashes * 2)}${entity}text`,
				);
			}
		}
	});

	it("preserves quotes and visible backslashes while collapsing control sequences", () => {
		const episode: Episode = {
			...demoEpisode,
			title: 'She said ""listen""\n\tthen\u0000\u001f\u007fopened C:\\Podcasts\\Episode',
		};

		expect(NoteTemplateEngine("{{title}}", episode)).toBe(
			'She said ""listen"" then opened C:\\\\Podcasts\\\\Episode',
		);
	});

	it("renders an injected ```dataviewjs code block inert while keeping normal formatting", () => {
		const malicious: Episode = {
			...demoEpisode,
			// htmlToMarkdown is a passthrough in the test mock, so this is what a feed
			// <content:encoded> would yield after conversion.
			content:
				"```dataviewjs\napp.vault.getFiles().forEach(f => f.unlink())\n```\n\nSome [docs](https://example.com) and a normal block:\n\n```js\nconsole.log(1)\n```",
		};
		const rendered = NoteTemplateEngine("{{content}}", malicious);

		// The executable language is dropped; the code remains visible but inert.
		expect(rendered).not.toContain("```dataviewjs");
		expect(rendered).toContain("```text");
		expect(rendered).toContain("app.vault.getFiles()");
		// Legitimate formatting (links, ordinary code fences) is preserved.
		expect(rendered).toContain("[docs](https://example.com)");
		expect(rendered).toContain("```js");
	});

	it("neutralizes ~~~dataview and case/spacing variants of executable fences", () => {
		const variants: Episode = {
			...demoEpisode,
			content: "~~~ DataViewJS\n42\n~~~",
		};
		const rendered = NoteTemplateEngine("{{content}}", variants);
		expect(rendered.toLowerCase()).not.toContain("dataviewjs");
		expect(rendered).toContain("~~~text");
		expect(rendered).toContain("42");
	});

	// Regression: htmlToMarkdown nests feed HTML in blockquotes/callouts and list
	// items, which would hide an executable fence from a line-anchored scanner.
	it("neutralizes a dataviewjs fence nested in a blockquote, callout, or list item", () => {
		const blockquoted: Episode = {
			...demoEpisode,
			content: "> ```dataviewjs\n> evil()\n> ```",
		};
		const callout: Episode = {
			...demoEpisode,
			content: "> [!note]\n> ```dataview\n> TABLE file.name\n> ```",
		};
		const listIndented: Episode = {
			...demoEpisode,
			content: "- item\n\n    ```dataviewjs\n    evil()\n    ```",
		};

		for (const ep of [blockquoted, callout, listIndented]) {
			const rendered = NoteTemplateEngine("{{content}}", ep).toLowerCase();
			expect(rendered).not.toContain("```dataviewjs");
			expect(rendered).not.toContain("```dataview");
		}
	});

	// Regression: a closing fence shorter than the opener must not desync a scanner
	// into skipping a later executable fence.
	it("neutralizes a dataviewjs fence that follows a longer fenced block", () => {
		const malicious: Episode = {
			...demoEpisode,
			content: "`````text\n```\n`````\n```dataviewjs\nevil()\n```",
		};
		const rendered = NoteTemplateEngine("{{content}}", malicious);
		expect(rendered).not.toContain("```dataviewjs");
	});

	it("preserves legitimate episode metadata when Markdown renders the encoded source", () => {
		// Plain text stays readable in source when it has no structural punctuation.
		expect(NoteTemplateEngine("# {{title}}", demoEpisode)).toBe("# Episode 1");
		expect(NoteTemplateEngine("{{url}}|{{artwork}}", demoEpisode)).toBe(
			"https://example.com/ep1|https://example.com/ep1.png",
		);
		// Context-sensitive punctuation is escaped in source; quotes and colons remain
		// readable, and Markdown renders the visible title exactly as supplied.
		const punctuated: Episode = {
			...demoEpisode,
			title: "Ep. 5: A.I. & You (Part 1)",
		};
		expect(NoteTemplateEngine("# {{title}}", punctuated)).toBe(
			String.raw`# Ep\. 5: A\.I\. &amp; You \(Part 1\)`,
		);
	});
});

describe("feed-controlled wikilink injection is neutralized (deepsec other-wikilink-injection)", () => {
	beforeEach(() => {
		plugin.set({
			settings: {
				feedNote: { path: "PodNotes/Podcasts/{{podcast}}.md" },
				savedFeeds: {},
			},
		} as never);
		downloadedEpisodes.set({});
	});

	it("strips brackets from a feed title so getFeedNoteWikilink emits a single wikilink", () => {
		const link = getFeedNoteWikilink("Real]] [[Victims Private Note");
		expect(link).toBe(
			"[[PodNotes/Podcasts/Real Victims Private Note|Real Victims Private Note]]",
		);
		// No extra wikilink boundary smuggled in.
		expect(link).not.toContain("]] [[");
	});

	it("prevents a feed podcastName from injecting a wikilink into {{podcastlink}}/{{podcast}}/{{safetitle}}", () => {
		const malicious: Episode = {
			...demoEpisode,
			podcastName: "Real]] [[Victims Private Note",
		};
		const podcastlink = NoteTemplateEngine("{{podcastlink}}", malicious);
		expect(podcastlink).not.toContain("]] [[");
		expect(podcastlink).toBe(
			"[[PodNotes/Podcasts/Real Victims Private Note|Real Victims Private Note]]",
		);

		expect(NoteTemplateEngine("{{podcast}}", malicious)).toBe("Real Victims Private Note");
		expect(
			NoteTemplateEngine("{{safetitle}}", {
				...demoEpisode,
				title: "Title]] [[Injected",
			}),
		).toBe("Title Injected");
	});

	it("keeps a real local-file wikilink in {{url}} intact (no false positives)", () => {
		const local = {
			...demoEpisode,
			podcastName: "local file",
			filePath: "Audio/My Talk.mp3", // plugin-set marker; a feed cannot forge it
			url: "[[Audio/My Talk.mp3]]",
		} as Episode;
		expect(NoteTemplateEngine("{{url}}", local)).toBe("[[Audio/My Talk.mp3]]");
	});

	it("neutralizes a feed episode whose url forges a wikilink", () => {
		const forged: Episode = {
			...demoEpisode,
			podcastName: "Evil Pod", // a feed, so the url is untrusted
			url: "[[Victims Private Note]]",
		};
		const rendered = NoteTemplateEngine("{{url}}", forged);
		expect(rendered).not.toContain("[[");
		expect(rendered).not.toContain("]]");
	});

	it("does not trust a feed whose <title> is forged to 'local file' (no filePath) — P1 #228", () => {
		// isLocalFile() alone (podcastName === "local file") is feed-controlled: the
		// feed parser sets podcastName from the channel <title>. Without a plugin-set
		// filePath the url stays untrusted and must be sanitized, so the bare {{url}}
		// line cannot be used to inject a wikilink/Markdown after this forgery.
		const forgedLocal: Episode = {
			...demoEpisode,
			podcastName: "local file", // forged feed title, but NO filePath
			feedUrl: "https://evil.example/feed.xml",
			url: "[[Victims Private Note]]",
		};
		const rendered = NoteTemplateEngine("{{url}}", forgedLocal);
		expect(rendered).not.toContain("[[");
		expect(rendered).not.toContain("]]");
	});
});
