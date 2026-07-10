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
import { isLocalFile } from "./utility/isLocalFile";
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

// The optional argument group uses `.*?` (zero-or-more), so a bare trailing
// colon ({{date:}}) is captured AS the argument group (params === ":") rather
// than being absorbed into the tag id — which previously yielded tagId "date:",
// an unknown tag, and a spurious "invalid tag" Notice (NT-05/CH-09).
const TEMPLATE_TAG_REGEX = /\{\{(.*?)(:\s*.*?)?\}\}/g;

export interface NoteTemplateContext {
	chapters?: Chapter[];
}

export function templateHasTag(template: string, tag: Lowercase<string>): boolean {
	return Array.from(template.matchAll(TEMPLATE_TAG_REGEX)).some(
		([, tagId]) => tagId.toLowerCase() === tag,
	);
}

function useTemplateEngine(): Readonly<[ReplacerFn, AddTagFn]> {
	const tags: Tags = {};

	function addTag(tag: Lowercase<string>, value: TagValue): void {
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
							similarTag.length > 0 ? ` Did you mean ${similarTag[0].item}?` : ""
						}`,
					);
					return match;
				}

				if (typeof tagValue === "function") {
					// Everything after the leading colon is a single argument. A bare
					// trailing colon ({{date:}}) means "use the tag default", same as a
					// bare {{date}} — not an empty format string (NT-05/CH-09). Only an
					// EMPTY argument is collapsed; a whitespace argument ({{description: }})
					// is preserved so the obscure space-prepend usage still works.
					const arg = params ? params.slice(1) : "";
					if (arg === "") {
						return tagValue();
					}

					// No tag takes more than one argument, and splitting on "," would
					// corrupt format strings that legitimately contain commas
					// (e.g. {{currentDate:MMMM D, YYYY}}).
					return tagValue(arg);
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

/**
 * Build a tag that strips file-name-illegal characters from `rawValue` and, when
 * the tag is used with an argument (e.g. `{{title:_}}`), collapses whitespace to
 * that replacement. Shared by the file-name {{title}}/{{podcast}} tags.
 */
function legalizedNameTag(rawValue: string): TagValue {
	return (whitespaceReplacement?: string) => {
		const legal = replaceIllegalFileNameCharactersInString(rawValue);
		return whitespaceReplacement ? legal.replace(/\s+/g, whitespaceReplacement) : legal;
	};
}

/**
 * Register the file-name-safe episode tags shared by every path/transcript
 * template engine: {{title}} and {{podcast}} (illegal-character-stripped, with an
 * optional whitespace-replacement arg), {{date}} (episode publish date),
 * {{currentdate}}, and {{episodenumber}}. NoteTemplateEngine intentionally does
 * NOT use this — there {{title}} is the raw episode title, not a file name.
 */
function addEpisodeFileNameTags(addTag: AddTagFn, episode: Episode): void {
	addTag("title", legalizedNameTag(episode.title));
	addTag("podcast", legalizedNameTag(episode.podcastName));
	addTag("date", (format?: string) =>
		episode.episodeDate ? formatDate(episode.episodeDate, format ?? "YYYY-MM-DD") : "",
	);
	addTag("currentdate", (format?: string) => formatDate(new Date(), format ?? "YYYY-MM-DD"));
	addTag("episodenumber", (pad?: string) =>
		formatEpisodeNumber(resolveEpisodeNumber(episode), pad),
	);
}

function formatChapterTitle(title: string): string {
	return title.replace(/\s+/g, " ").trim();
}

/**
 * Encode plain text for an arbitrary Markdown body position. The template engine
 * cannot know whether a tag is placed at the start of a line, after text that can
 * become a Setext heading, or inside another Markdown construct, so every
 * CommonMark/Obsidian punctuation character that can change structure is escaped
 * everywhere. Quotes, colons, commas, and other inert prose punctuation remain
 * readable in source; all escapes render as the original visible characters.
 *
 * Ampersands must be encoded before producing the angle-bracket entities. This
 * preserves a literal input such as `&lt;` instead of letting it decode into `<`.
 * Input backslashes and slash-escaped punctuation are handled in one replacement,
 * so a punctuation character after n input backslashes always has 2n + 1 slashes.
 */
function escapeMarkdownText(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/[\\`*_{}[\]()#+.!|=~$%^-]/g, "\\$&");
}

/**
 * Collapse a feed-controlled title/author to one line, then encode it as plain
 * Markdown body text. This blocks both inline constructs and line-leading block
 * constructs regardless of where a user places the tag in a body template.
 *
 * This is not a YAML or JavaScript string encoder. The built-in templates keep
 * these metadata tags out of frontmatter and executable code, and custom templates
 * must maintain that context boundary.
 */
function escapeMarkdownBodyText(text: string): string {
	// eslint-disable-next-line no-control-regex
	const singleLine = text.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
	return escapeMarkdownText(singleLine);
}

/**
 * Render inert any executable Dataview code fence (```dataviewjs / ```dataview,
 * including ~~~ fences) that a feed smuggled through `htmlToMarkdown`, in ANY
 * Markdown container - top level, blockquote, callout, or list item - so the
 * blockquote/list-indent nesting `htmlToMarkdown` produces cannot hide it.
 *
 * A run of three or more fence characters immediately followed by one of these
 * language tokens only ever occurs as a code-fence info string, so rewriting that
 * token to a non-executable one is always safe regardless of container or whether
 * the fence is technically the opener or closer; ordinary code blocks and the rest
 * of the show-note formatting are left intact. Feed content is never a legitimate
 * source of executable Dataview (a feed cannot author a query against the reader's
 * vault), so this has no false positives on genuine show notes.
 */
function neutralizeExecutableCodeBlocks(markdown: string): string {
	return markdown.replace(/(`{3,}|~{3,})[ \t]*(?:dataviewjs|dataview)\b/gi, "$1text");
}

/**
 * Convert feed-controlled HTML to Markdown and render any executable Dataview code
 * fence inert. `htmlToMarkdown` strips active HTML (scripts, `javascript:`), and
 * this additionally closes the `<pre><code class="language-dataviewjs">` ->
 * ```dataviewjs code-execution path.
 *
 * Legitimate rich-text formatting in show notes (links, images, ordinary code
 * blocks) is intentionally preserved: rendering the feed's own show notes is the
 * purpose of {{description}}/{{content}}. That means a feed can still place an
 * external image (a reader can disable external image loading in Obsidian) or a
 * literal [[wikilink]] in this free-text body; unlike the structured tags
 * ({{title}}, {{podcastlink}}, the URL tags) these are accepted as show-note
 * content. Inline Dataview queries (`= ...`/`$= ...`) are a known residual of the
 * same speculative, Dataview-must-be-installed class and are not rewritten here to
 * avoid mangling legitimate inline code in programming show notes.
 */
function feedHtmlToMarkdown(html: string): string {
	return neutralizeExecutableCodeBlocks(htmlToMarkdown(html));
}

function formatTemplateChapters(chapters: Chapter[] | undefined, prependToLines?: string): string {
	const lines = normalizeChapters(chapters ?? []).map((chapter) => {
		const title = formatChapterTitle(chapter.title);
		const escapedTitle = title ? ` ${escapeMarkdownText(title)}` : "";

		return `- ${formatDuration(chapter.startTime)}${escapedTitle}`;
	});

	if (!prependToLines) {
		return lines.join("\n");
	}

	return lines.map((line) => `${prependToLines}${line}`).join("\n");
}

/**
 * Resolve {{url}}/{{episodeurl}}. A genuine local-file episode stores a
 * vault-generated wikilink in `url` that must pass through verbatim (sanitizing it
 * would break the link). That trust is gated on the plugin-set `filePath` - a feed
 * cannot forge it (only `getContextMenuHandler` sets it; `feedParser` never does) -
 * NOT on `podcastName === "local file"` alone, which an attacker controls via the
 * feed <title> and could otherwise use to skip sanitization (P1, PR #228 review).
 * Every other (feed) episode's url is attacker-controlled and is sanitized so it
 * cannot inject Markdown/wikilinks on the bare `{{url}}` line.
 */
function resolveEpisodeUrl(episode: Episode): string {
	return isLocalFile(episode) && episode.filePath
		? episode.url
		: sanitizeUrlForTemplate(episode.url);
}

export function NoteTemplateEngine(
	template: string,
	episode: Episode,
	context: NoteTemplateContext = {},
) {
	const [replacer, addTag] = useTemplateEngine();

	const episodeUrl = resolveEpisodeUrl(episode);

	addTag("title", escapeMarkdownBodyText(episode.title));
	addTag("description", (prependToLines?: string) => {
		// reduce multiple new lines
		const sanitizeDescription = feedHtmlToMarkdown(episode.description).replace(
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
			return feedHtmlToMarkdown(episode.content)
				.split("\n")
				.map((str) => `${prependToLines}${str}`)
				.join("\n");
		}

		return feedHtmlToMarkdown(episode.content);
	});
	addTag("safetitle", replaceIllegalFileNameCharactersInString(episode.title));
	addTag("stream", sanitizeUrlForTemplate(episode.streamUrl));
	addTag("url", episodeUrl);
	addTag("date", (format?: string) =>
		episode.episodeDate ? formatDate(episode.episodeDate, format ?? "YYYY-MM-DD") : "",
	);
	// The current date the note is created on, distinct from {{date}} (the episode
	// publish date). Supports the same Moment.js format arg. See issue #75.
	addTag("currentdate", (format?: string) => formatDate(new Date(), format ?? "YYYY-MM-DD"));
	// Episode number from <itunes:episode>, else best-effort from the title. See #34.
	addTag("episodenumber", (pad?: string) =>
		formatEpisodeNumber(resolveEpisodeNumber(episode), pad),
	);
	// Episode duration from <itunes:duration>. See issue #88.
	addTag("duration", (format?: string) =>
		episode.duration !== undefined ? formatDuration(episode.duration, format) : "",
	);
	// Podcasting 2.0 chapters, fetched before note creation when the template
	// asks for them. Empty when the feed has no chapters URL or fetching fails.
	addTag("chapters", (prependToLines?: string) =>
		formatTemplateChapters(context.chapters, prependToLines),
	);
	addTag("podcast", replaceIllegalFileNameCharactersInString(episode.podcastName));
	addTag("artwork", sanitizeUrlForTemplate(episode.artworkUrl ?? ""));

	// Feed-scoped tags so an episode note can reference its parent podcast feed
	// without changing the meaning of the existing {{url}}/{{artwork}} tags
	// (which always describe the episode itself). See issue #163.
	addTag("episodeurl", episodeUrl);
	addTag("episodeartwork", sanitizeUrlForTemplate(episode.artworkUrl ?? ""));
	addTag("feedurl", sanitizeUrlForTemplate(episode.feedUrl ?? ""));
	const parentFeed = get(plugin)?.settings?.savedFeeds?.[episode.podcastName];
	addTag(
		"feedartwork",
		sanitizeUrlForTemplate(parentFeed?.artworkUrl ?? episode.artworkUrl ?? ""),
	);
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
			return api.getPodcastTimeFormatted(format ?? "HH:mm:ss", false, timestampOffset);
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
			return api.getPodcastTimeFormatted(format ?? "HH:mm:ss", true, timestampOffset);
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

	addEpisodeFileNameTags(addTag, episode);

	return replacer(template);
}

export function DownloadPathTemplateEngine(template: string, episode: Episode) {
	// Removing the template extension, as this is added automatically depending on
	// file type. Anchor the strip at end-of-string: getUrlExtension returns the
	// FIRST '.ext' followed by '?'/'#'/end, which need not be the trailing one, so
	// a positional `.replace(ext, "")` could corrupt a folder name that happens to
	// contain the same string earlier in the path (#DL-04).
	const templateExtension = getUrlExtension(template);
	const templateWithoutExtension = templateExtension
		? template.replace(
				new RegExp(`\\.${templateExtension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
				"",
			)
		: template;

	const [replacer, addTag] = useTemplateEngine();

	addEpisodeFileNameTags(addTag, episode);

	return replacer(templateWithoutExtension);
}

export function TranscriptTemplateEngine(
	template: string,
	episode: Episode,
	transcription: string,
) {
	const [replacer, addTag] = useTemplateEngine();

	addEpisodeFileNameTags(addTag, episode);
	addTag("duration", (format?: string) =>
		episode.duration !== undefined ? formatDuration(episode.duration, format) : "",
	);
	addTag("transcript", transcription);
	addTag("description", (prependToLines?: string) => {
		if (prependToLines) {
			return feedHtmlToMarkdown(episode.description)
				.split("\n")
				.map((str) => `${prependToLines}${str}`)
				.join("\n");
		}

		return feedHtmlToMarkdown(episode.description);
	});
	addTag("url", resolveEpisodeUrl(episode));
	addTag("artwork", sanitizeUrlForTemplate(episode.artworkUrl ?? ""));

	return replacer(template);
}

export function FeedNoteTemplateEngine(template: string, feed: PodcastFeed) {
	const [replacer, addTag] = useTemplateEngine();

	const safeTitle = replaceIllegalFileNameCharactersInString(feed.title);

	// In a feed note the subject is the feed, so {{url}}/{{artwork}} describe the
	// feed (mirroring how they describe the episode in NoteTemplateEngine). The raw
	// {{title}}/{{author}} are feed-controlled, so they are neutralized so a crafted
	// feed cannot inject Markdown/HTML into the note body.
	addTag("title", escapeMarkdownBodyText(feed.title));
	addTag("safetitle", safeTitle);
	addTag("podcast", safeTitle);
	// URL tags are sanitized so they stay safe as Markdown link/image targets and
	// inside quoted YAML frontmatter scalars (the default feed template uses both).
	// A well-formed URL never contains the characters this neutralizes.
	addTag("url", sanitizeUrlForTemplate(feed.link ?? ""));
	addTag("feedurl", sanitizeUrlForTemplate(feed.url));
	addTag("artwork", sanitizeUrlForTemplate(feed.artworkUrl ?? ""));
	addTag("feedartwork", sanitizeUrlForTemplate(feed.artworkUrl ?? ""));
	addTag("author", escapeMarkdownBodyText(feed.author ?? ""));
	addTag("description", (prependToLines?: string) => {
		const sanitizeDescription = feedHtmlToMarkdown(feed.description ?? "").replace(
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
	addTag("date", (format?: string) => formatDate(new Date(), format ?? "YYYY-MM-DD"));

	return replacer(template);
}

export function FeedFilePathTemplateEngine(template: string, feed: PodcastFeed) {
	const [replacer, addTag] = useTemplateEngine();

	const nameTag = legalizedNameTag(feed.title);
	addTag("title", nameTag);
	addTag("podcast", nameTag);
	addTag("date", (format?: string) => formatDate(new Date(), format ?? "YYYY-MM-DD"));

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

	return linkPath.includes("/") ? `[[${linkPath}|${basename}]]` : `[[${basename}]]`;
}

/**
 * Make a feed-controlled URL safe to embed as a Markdown link/image target, a
 * bare-line autolink, and a double-quoted YAML scalar. A well-formed URL never
 * contains whitespace, control characters, quotes, backslashes, backticks,
 * angle brackets, or parentheses/square brackets - all of which would let a
 * crafted value break out of `![](...)` / `[](...)`, inject extra lines, or
 * terminate a quoted YAML scalar. They are percent-encoded (not stripped) so
 * legitimate URLs keep working while malicious feed values are neutralized; the
 * scheme/path separators (`:` `/` `?` `&` `=` `#` `%`) are preserved so real
 * URLs are unchanged.
 */
function sanitizeUrlForTemplate(url: string): string {
	// eslint-disable-next-line no-control-regex
	return url.replace(/[\u0000-\u0020"'`()[\]<>\\]/g, (char) => {
		return `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
	});
}

export function replaceIllegalFileNameCharactersInString(string: string) {
	return (
		string
			// Strip characters that are illegal in file names on major platforms,
			// plus a few the plugin removes for clean paths/wikilinks. The square
			// brackets are included so a feed-controlled title cannot inject an
			// Obsidian [[wikilink]] when used as a link name (e.g. {{podcastlink}}
			// built from a feed <title>). Dots are intentionally preserved so titles
			// like "Episode 1.5" are not mangled into "Episode 15".
			.replace(/[\\,#%&{}/*<>$'":@\u2023|?[\]]/g, "")
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
