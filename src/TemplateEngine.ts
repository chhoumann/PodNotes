import Fuse from "fuse.js";
import { htmlToMarkdown, Notice } from "obsidian";
import { plugin } from "src/store";
import { get } from "svelte/store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import getUrlExtension from "./utility/getUrlExtension";
import { formatDate } from "./utility/formatDate";
import { formatDuration } from "./utility/formatDuration";
import { formatEpisodeNumber } from "./utility/formatEpisodeNumber";
import { parseEpisodeNumberFromTitle } from "./utility/parseEpisodeNumber";
import buildEpisodeResumeLink from "./utility/buildEpisodeResumeLink";
import addExtension from "./utility/addExtension";
import { enforceMaxPathLength } from "./utility/enforceMaxPathLength";
import type { PodcastSegmentTimes } from "./utility/podcastSegment";
import type { Chapter } from "./types/Chapter";
import { normalizeChapters } from "./utility/normalizeChapters";

// Each tag is either a literal string or a function taking at most one argument
// (the raw text after the leading colon, e.g. the format in {{date:YYYY}}). The
// engine never passes more than one argument; commas are part of that argument.
type TagValue = string | ((arg?: string) => string);

interface Tags {
	[tag: string]: TagValue;
}

type AddTagFn = (tag: Lowercase<string>, value: TagValue) => void;
type ReplacerFn = (template: string) => string;

const TEMPLATE_TAG_REGEX = /\{\{(.*?)(:\s*?.+?)?\}\}/g;

export interface NoteTemplateContext {
	chapters?: Chapter[];
}

export function templateHasTag(
	template: string,
	tag: Lowercase<string>,
): boolean {
	return Array.from(template.matchAll(TEMPLATE_TAG_REGEX)).some(
		([, tagId]) => tagId.toLowerCase() === tag,
	);
}

function useTemplateEngine(): Readonly<[ReplacerFn, AddTagFn]> {
	const tags: Tags = {};

	function addTag(
		tag: Lowercase<string>,
		value: TagValue,
	): void {
		tags[tag] = value;
	}

	function replacer(template: string): string {
		return template.replace(
			TEMPLATE_TAG_REGEX,
			(match: string, tagId: string, params: string) => {
				const tagValue = tags[tagId.toLowerCase()];
				if (tagValue === null || tagValue === undefined) {
					const fuse = new Fuse(Object.keys(tags), {
						shouldSort: true,
						findAllMatches: false,
						threshold: 0.4,
						isCaseSensitive: false,
					});

					const similarTag = fuse.search(tagId);

					new Notice(
						`Tag ${tagId} is invalid.${
							similarTag.length > 0
								? ` Did you mean ${similarTag[0].item}?`
								: ""
						}`,
					);
					return match;
				}

				if (typeof tagValue === "function") {
					if (params) {
						// Pass everything after the leading colon as a single argument.
						// No tag takes more than one argument, and splitting on "," would
						// corrupt format strings that legitimately contain commas
						// (e.g. {{currentDate:MMMM D, YYYY}}).
						return tagValue(params.slice(1));
					}

					return tagValue();
				}

				return tagValue;
			},
		);
	}

	return [replacer, addTag] as const;
}

/**
 * Resolve the episode number for templates: prefer the value captured at parse
 * time (from `<itunes:episode>` or the title), then fall back to a title parse so
 * persisted/older episode snapshots that predate the stored field (e.g. a restored
 * `currentEpisode`) still resolve `{{episodeNumber}}`.
 */
function resolveEpisodeNumber(episode: Episode): number | undefined {
	return episode.episodeNumber ?? parseEpisodeNumberFromTitle(episode.title);
}

function formatChapterTitle(title: string): string {
	return title.replace(/\s+/g, " ").trim();
}

function escapeMarkdownText(text: string): string {
	return text
		.replace(/\\/g, "\\\\")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/([`*_{}[\]()#+.!|-])/g, "\\$1");
}

function formatTemplateChapters(
	chapters: Chapter[] | undefined,
	prependToLines?: string,
): string {
	const lines = normalizeChapters(chapters ?? [])
		.map(
			(chapter) =>
				`- ${formatDuration(chapter.startTime)} ${escapeMarkdownText(formatChapterTitle(chapter.title))}`,
		);

	if (!prependToLines) {
		return lines.join("\n");
	}

	return lines.map((line) => `${prependToLines}${line}`).join("\n");
}

export function NoteTemplateEngine(
	template: string,
	episode: Episode,
	context: NoteTemplateContext = {},
) {
	const [replacer, addTag] = useTemplateEngine();

	addTag("title", episode.title);
	addTag("description", (prependToLines?: string) => {
		// reduce multiple new lines
		const sanitizeDescription = htmlToMarkdown(episode.description).replace(
			/\n{3,}/g,
			"\n\n",
		);
		if (prependToLines) {
			return sanitizeDescription
				.split("\n")
				.map((str) => `${prependToLines}${str}`)
				.join("\n");
		}

		return sanitizeDescription;
	});
	addTag("content", (prependToLines?: string) => {
		if (prependToLines) {
			return htmlToMarkdown(episode.content)
				.split("\n")
				.map((str) => `${prependToLines}${str}`)
				.join("\n");
		}

		return htmlToMarkdown(episode.content);
	});
	addTag("safetitle", replaceIllegalFileNameCharactersInString(episode.title));
	addTag("stream", episode.streamUrl);
	addTag("url", episode.url);
	addTag("date", (format?: string) =>
		episode.episodeDate
			? formatDate(episode.episodeDate, format ?? "YYYY-MM-DD")
			: "",
	);
	// The current date the note is created on, distinct from {{date}} (the episode
	// publish date). Supports the same Moment.js format arg. See issue #75.
	addTag("currentdate", (format?: string) =>
		formatDate(new Date(), format ?? "YYYY-MM-DD"),
	);
	// Episode number from <itunes:episode>, else best-effort from the title. See #34.
	addTag("episodenumber", (pad?: string) =>
		formatEpisodeNumber(resolveEpisodeNumber(episode), pad),
	);
	// Episode duration from <itunes:duration>. See issue #88.
	addTag("duration", (format?: string) =>
		episode.duration !== undefined
			? formatDuration(episode.duration, format)
			: "",
	);
	// Podcasting 2.0 chapters, fetched before note creation when the template
	// asks for them. Empty when the feed has no chapters URL or fetching fails.
	addTag("chapters", (prependToLines?: string) =>
		formatTemplateChapters(context.chapters, prependToLines),
	);
	addTag(
		"podcast",
		replaceIllegalFileNameCharactersInString(episode.podcastName),
	);
	addTag("artwork", episode.artworkUrl ?? "");

	// Feed-scoped tags so an episode note can reference its parent podcast feed
	// without changing the meaning of the existing {{url}}/{{artwork}} tags
	// (which always describe the episode itself). See issue #163.
	addTag("episodeurl", episode.url);
	addTag("episodeartwork", episode.artworkUrl ?? "");
	addTag("feedurl", episode.feedUrl ?? "");
	const parentFeed =
		get(plugin)?.settings?.savedFeeds?.[episode.podcastName];
	addTag("feedartwork", parentFeed?.artworkUrl ?? episode.artworkUrl ?? "");
	// A ready-made wikilink to the parent feed's note, pointing at the same file
	// createFeedNote writes (derived from the feed-note path setting).
	addTag("podcastlink", getFeedNoteWikilink(episode.podcastName));
	// A clickable obsidian://podnotes deep link that reopens this episode in the
	// player and resumes from the last played location (or the start if it has
	// never been played). The resume point is resolved at click time, not baked
	// in here, so a single templated link always jumps to where you left off.
	// Empty when the episode has no feed/file URL to address it by. See issue #35.
	addTag("episodelink", buildEpisodeResumeLink(episode));

	return replacer(template);
}

export function TimestampTemplateEngine(
	template: string,
	options: { segment?: PodcastSegmentTimes } = {},
) {
	const [replacer, addTag] = useTemplateEngine();
	const { api, settings } = get(plugin);
	const timestampOffset = settings.timestamp.offset ?? 0;

	addTag("time", (format?: string) =>
		api.getPodcastTimeFormatted(format ?? "HH:mm:ss", false, timestampOffset),
	);
	addTag("linktime", (format?: string) =>
		api.getPodcastTimeFormatted(format ?? "HH:mm:ss", true, timestampOffset),
	);
	addTag("segment", (format?: string) => {
		if (!options.segment) {
			return api.getPodcastTimeFormatted(
				format ?? "HH:mm:ss",
				false,
				timestampOffset,
			);
		}

		return api.getPodcastSegmentFormatted(
			format ?? "HH:mm:ss",
			options.segment.startTime,
			options.segment.endTime,
			false,
		);
	});
	addTag("linksegment", (format?: string) => {
		if (!options.segment) {
			return api.getPodcastTimeFormatted(
				format ?? "HH:mm:ss",
				true,
				timestampOffset,
			);
		}

		return api.getPodcastSegmentFormatted(
			format ?? "HH:mm:ss",
			options.segment.startTime,
			options.segment.endTime,
			true,
		);
	});

	return replacer(template);
}

export function FilePathTemplateEngine(template: string, episode: Episode) {
	const [replacer, addTag] = useTemplateEngine();

	addTag("title", (whitespaceReplacement?: string) => {
		const legalTitle = replaceIllegalFileNameCharactersInString(episode.title);
		if (whitespaceReplacement) {
			return legalTitle.replace(/\s+/g, whitespaceReplacement);
		}

		return legalTitle;
	});
	addTag("podcast", (whitespaceReplacement?: string) => {
		const legalName = replaceIllegalFileNameCharactersInString(
			episode.podcastName,
		);
		if (whitespaceReplacement) {
			return legalName.replace(/\s+/g, whitespaceReplacement);
		}

		return legalName;
	});
	addTag("date", (format?: string) =>
		episode.episodeDate
			? formatDate(episode.episodeDate, format ?? "YYYY-MM-DD")
			: "",
	);
	addTag("currentdate", (format?: string) =>
		formatDate(new Date(), format ?? "YYYY-MM-DD"),
	);
	addTag("episodenumber", (pad?: string) =>
		formatEpisodeNumber(resolveEpisodeNumber(episode), pad),
	);

	return replacer(template);
}

export function DownloadPathTemplateEngine(template: string, episode: Episode) {
	// Removing the template extension, as this is added automatically depending on file type.
	const templateExtension = getUrlExtension(template);
	const templateWithoutExtension = templateExtension
		? template.replace(templateExtension, "")
		: template;

	const [replacer, addTag] = useTemplateEngine();

	addTag("title", (whitespaceReplacement?: string) => {
		const legalTitle = replaceIllegalFileNameCharactersInString(episode.title);
		if (whitespaceReplacement) {
			return legalTitle.replace(/\s+/g, whitespaceReplacement);
		}

		return legalTitle;
	});
	addTag("podcast", (whitespaceReplacement?: string) => {
		const legalName = replaceIllegalFileNameCharactersInString(
			episode.podcastName,
		);
		if (whitespaceReplacement) {
			return legalName.replace(/\s+/g, whitespaceReplacement);
		}

		return legalName;
	});
	addTag("date", (format?: string) =>
		episode.episodeDate
			? formatDate(episode.episodeDate, format ?? "YYYY-MM-DD")
			: "",
	);
	addTag("currentdate", (format?: string) =>
		formatDate(new Date(), format ?? "YYYY-MM-DD"),
	);
	addTag("episodenumber", (pad?: string) =>
		formatEpisodeNumber(resolveEpisodeNumber(episode), pad),
	);

	return replacer(templateWithoutExtension);
}

export function TranscriptTemplateEngine(
	template: string,
	episode: Episode,
	transcription: string,
) {
	const [replacer, addTag] = useTemplateEngine();

	addTag("title", (whitespaceReplacement?: string) => {
		const legalTitle = replaceIllegalFileNameCharactersInString(episode.title);
		if (whitespaceReplacement) {
			return legalTitle.replace(/\s+/g, whitespaceReplacement);
		}
		return legalTitle;
	});
	addTag("podcast", (whitespaceReplacement?: string) => {
		const legalName = replaceIllegalFileNameCharactersInString(
			episode.podcastName,
		);
		if (whitespaceReplacement) {
			return legalName.replace(/\s+/g, whitespaceReplacement);
		}
		return legalName;
	});
	addTag("date", (format?: string) =>
		episode.episodeDate
			? formatDate(episode.episodeDate, format ?? "YYYY-MM-DD")
			: "",
	);
	addTag("currentdate", (format?: string) =>
		formatDate(new Date(), format ?? "YYYY-MM-DD"),
	);
	addTag("episodenumber", (pad?: string) =>
		formatEpisodeNumber(resolveEpisodeNumber(episode), pad),
	);
	addTag("duration", (format?: string) =>
		episode.duration !== undefined
			? formatDuration(episode.duration, format)
			: "",
	);
	addTag("transcript", transcription);
	addTag("description", (prependToLines?: string) => {
		if (prependToLines) {
			return htmlToMarkdown(episode.description)
				.split("\n")
				.map((str) => `${prependToLines}${str}`)
				.join("\n");
		}

		return htmlToMarkdown(episode.description);
	});
	addTag("url", episode.url);
	addTag("artwork", episode.artworkUrl ?? "");

	return replacer(template);
}

export function FeedNoteTemplateEngine(template: string, feed: PodcastFeed) {
	const [replacer, addTag] = useTemplateEngine();

	const safeTitle = replaceIllegalFileNameCharactersInString(feed.title);

	// In a feed note the subject is the feed, so {{url}}/{{artwork}} describe the
	// feed (mirroring how they describe the episode in NoteTemplateEngine).
	addTag("title", feed.title);
	addTag("safetitle", safeTitle);
	addTag("podcast", safeTitle);
	// URL tags are sanitized so they stay valid inside quoted YAML frontmatter
	// scalars (the default feed template quotes them). A well-formed URL never
	// contains a raw double-quote, backslash, or control character.
	addTag("url", sanitizeUrlForTemplate(feed.link ?? ""));
	addTag("feedurl", sanitizeUrlForTemplate(feed.url));
	addTag("artwork", sanitizeUrlForTemplate(feed.artworkUrl ?? ""));
	addTag("feedartwork", sanitizeUrlForTemplate(feed.artworkUrl ?? ""));
	addTag("author", feed.author ?? "");
	addTag("description", (prependToLines?: string) => {
		const sanitizeDescription = htmlToMarkdown(feed.description ?? "").replace(
			/\n{3,}/g,
			"\n\n",
		);
		if (prependToLines) {
			return sanitizeDescription
				.split("\n")
				.map((str) => `${prependToLines}${str}`)
				.join("\n");
		}

		return sanitizeDescription;
	});
	addTag("date", (format?: string) =>
		formatDate(new Date(), format ?? "YYYY-MM-DD"),
	);

	return replacer(template);
}

export function FeedFilePathTemplateEngine(template: string, feed: PodcastFeed) {
	const [replacer, addTag] = useTemplateEngine();

	const safeName = replaceIllegalFileNameCharactersInString(feed.title);
	const nameTag = (whitespaceReplacement?: string) =>
		whitespaceReplacement
			? safeName.replace(/\s+/g, whitespaceReplacement)
			: safeName;

	addTag("title", nameTag);
	addTag("podcast", nameTag);
	addTag("date", (format?: string) =>
		formatDate(new Date(), format ?? "YYYY-MM-DD"),
	);

	return replacer(template);
}

/**
 * Build the wikilink an episode's {{podcastlink}} emits to its feed note,
 * derived from the configured feed-note path so it points at the exact file
 * `createFeedNote` writes. When that path has a folder the link is
 * path-qualified (`[[folder/Name|Name]]`) so it can never resolve to an
 * unrelated note that happens to share the basename; otherwise a plain
 * `[[Name]]` is used. Falls back to the sanitized feed name when no feed-note
 * path is configured (or the plugin store is not yet ready, e.g. in unit tests).
 */
export function getFeedNoteWikilink(feedTitle: string): string {
	const fallback = replaceIllegalFileNameCharactersInString(feedTitle);
	const path = get(plugin)?.settings?.feedNote?.path?.trim();

	if (!path) return `[[${fallback}]]`;

	const rendered = FeedFilePathTemplateEngine(path, {
		title: feedTitle,
		url: "",
		artworkUrl: "",
	});
	// Apply the same length cap createFeedNote uses (#22) so the link targets the
	// exact file written even when a long feed title is truncated. Mirror its
	// `enforceMaxPathLength(addExtension(...))` derivation, then drop the .md.
	const capped = enforceMaxPathLength(addExtension(rendered, "md"));
	const linkPath = capped.replace(/\.md$/i, "").trim();
	const basename = linkPath.split("/").pop()?.trim() || fallback;

	return linkPath.includes("/")
		? `[[${linkPath}|${basename}]]`
		: `[[${basename}]]`;
}

/**
 * Strip the two characters that would break a double-quoted YAML scalar
 * (and never appear in a well-formed URL): the double-quote that ends the
 * scalar and the backslash that YAML reads as an escape. Lossless for valid
 * URLs; only sanitizes malformed feeds so quoted frontmatter stays valid.
 */
function sanitizeUrlForTemplate(url: string): string {
	return url.replace(/["\\]/g, "");
}

export function replaceIllegalFileNameCharactersInString(string: string) {
	return (
		string
			// Strip characters that are illegal in file names on major platforms,
			// plus a few the plugin removes for clean paths/wikilinks. Dots are
			// intentionally preserved so titles like "Episode 1.5" are not mangled
			// into "Episode 15".
			.replace(/[\\,#%&{}/*<>$'":@\u2023|?]/g, "")
			// Replace any control characters (newlines, tabs, carriage returns)
			// with spaces so they can never end up in a file name.
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u001f]/g, " ")
			// Collapse every run of whitespace into a single space.
			.replace(/\s+/g, " ")
			.trim()
			// Avoid leading/trailing dots, which create hidden files or "."/".."
			// segments and are rejected on Windows/Android.
			.replace(/^\.+/, "")
			.replace(/\.+$/, "")
			.trim()
	);
}
