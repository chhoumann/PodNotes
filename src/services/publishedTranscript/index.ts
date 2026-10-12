import { isPlainObject } from "src/persistence/codecUtils";
import type { FeedKey, FeedRepository } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import { NetworkError, fetchTextWithTimeout } from "src/utility/networkRequest";
import { type ParsedTranscript, parseTranscript, type TranscriptFormat } from "./parse";

export { renderTranscriptBody, timestampStyle } from "./render";

/** The formats PodNotes reads by their MIME types, preferred in this order: timed ones first. */
const FORMATS: ReadonlyArray<readonly [TranscriptFormat, readonly string[]]> = [
	["vtt", ["text/vtt"]],
	["srt", ["application/x-subrip", "application/srt", "text/srt"]],
	["json", ["application/json"]],
	["html", ["text/html"]],
	["text", ["text/plain"]],
];

/** A transcript an episode's feed item links to, with the link as the feed wrote it. */
export interface PublishedTranscript {
	readonly key: FeedKey;
	readonly link: string;
	readonly format: TranscriptFormat;
}

/**
 * The link of the most preferred format among a feed item's transcript links,
 * the first one on a tie. `links` comes from the feed cache, which stores them
 * unchecked, so each entry is checked here. A link without a known type is never
 * chosen.
 */
export function choosePublishedTranscript(
	key: FeedKey,
	links: unknown,
): PublishedTranscript | undefined {
	let best: { rank: number; link: string } | undefined;
	for (const link of Array.isArray(links) ? links : []) {
		if (!isPlainObject(link) || typeof link.url !== "string" || typeof link.type !== "string") {
			continue;
		}
		const type = link.type.split(";")[0].trim().toLowerCase();
		const rank = FORMATS.findIndex(([, types]) => types.includes(type));
		if (rank >= 0 && (!best || rank < best.rank)) best = { rank, link: link.url };
	}
	return best && { key, link: best.link, format: FORMATS[best.rank][0] };
}

/**
 * The transcript the episode's feed publishes, when PodNotes can read it. Loads
 * the subscription's feed when no complete fresh copy is at hand. An episode
 * from a local file, or from a feed it is not subscribed to under its podcast
 * name, has none.
 */
export async function findPublishedTranscript(
	feeds: Pick<FeedRepository, "load" | "episodeMetadata">,
	episode: Episode,
): Promise<PublishedTranscript | undefined> {
	const key = episode.podcastName;
	await feeds.load([key], "complete");
	return choosePublishedTranscript(key, feeds.episodeMetadata(key, episode)?.transcripts);
}

/** Its message is safe to show: it never holds the transcript's URL. */
export class PublishedTranscriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PublishedTranscriptError";
	}
}

/** Fetch and parse a published transcript, in one attempt. */
export async function fetchPublishedTranscript(
	feeds: Pick<FeedRepository, "itemUrl">,
	source: PublishedTranscript,
	signal: AbortSignal,
): Promise<ParsedTranscript> {
	const url = feeds.itemUrl(source.key, source.link);
	if (!url) {
		throw new PublishedTranscriptError(
			"The published transcript could not be fetched: its address is not valid.",
		);
	}
	let text: string;
	try {
		text = await fetchTextWithTimeout(url, {
			timeoutMs: 30_000,
			maxResponseBytes: 16 * 1024 * 1024,
			acceptedStatuses: [200],
			signal,
		});
	} catch (error) {
		if (signal.aborted) throw error;
		throw new PublishedTranscriptError(
			`The published transcript could not be fetched: ${error instanceof NetworkError ? error.message : "Network request failed."}`,
		);
	}
	const transcript = parseTranscript(source.format, text);
	if (!transcript) {
		throw new PublishedTranscriptError("The published transcript could not be read.");
	}
	return transcript;
}
