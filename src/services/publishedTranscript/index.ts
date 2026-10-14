import type { TranscriptLink } from "src/parser/feedDocumentParser";
import type { FeedKey, FeedRepository } from "src/services/FeedRepository";
import { withoutPrivateFeedAddresses } from "src/services/privateFeeds";
import type { Episode } from "src/types/Episode";
import { NetworkError, fetchTextWithTimeout } from "src/utility/networkRequest";
import {
	isCredentialBearingUrl,
	privateFeedPlaceholder,
	redactPrivateFeedAddresses,
} from "src/utility/privateFeedUrl";
import { type ParsedTranscript, parseTranscript, type TranscriptFormat } from "./parse";

export { renderTranscriptBody, timestampStyle } from "./render";

const FORMATS_BY_PREFERENCE: ReadonlyArray<readonly [TranscriptFormat, readonly string[]]> = [
	["vtt", ["text/vtt"]],
	["srt", ["application/x-subrip", "application/srt", "text/srt"]],
	["json", ["application/json"]],
	["html", ["text/html"]],
	["text", ["text/plain"]],
];

export interface PublishedTranscript {
	readonly key: FeedKey;
	readonly reference: string;
	readonly format: TranscriptFormat;
}

export function choosePublishedTranscript(
	key: FeedKey,
	links: readonly TranscriptLink[] | undefined,
): PublishedTranscript | undefined {
	let best: { rank: number; reference: string } | undefined;
	for (const link of links ?? []) {
		const type = link.type?.split(";")[0].trim().toLowerCase();
		const rank = FORMATS_BY_PREFERENCE.findIndex(
			([, types]) => type !== undefined && types.includes(type),
		);
		if (rank >= 0 && (!best || rank < best.rank)) best = { rank, reference: link.url };
	}
	return best && { key, reference: best.reference, format: FORMATS_BY_PREFERENCE[best.rank][0] };
}

export async function findPublishedTranscript(
	feeds: Pick<FeedRepository, "load" | "episodeMetadata">,
	episode: Episode,
): Promise<PublishedTranscript | undefined> {
	const key = episode.podcastName;
	const loaded = await feeds.load([key], "cached");
	let item = feeds.episodeMetadata(key, episode);
	// The cache keeps a long feed's newest items, so only an older episode waits for the
	// whole feed. A feed the first load failed to fetch is not asked twice.
	if (!item && loaded) {
		await feeds.load([key], "complete");
		item = feeds.episodeMetadata(key, episode);
	}
	return choosePublishedTranscript(key, item?.transcripts);
}

export class PublishedTranscriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PublishedTranscriptError";
	}
}

/**
 * The episode's published transcript. Its text keeps no private address, neither its private
 * feed's nor its own when that carries a credential, so every reader of it gets the same text.
 */
export async function fetchPublishedTranscript(
	feeds: Pick<FeedRepository, "itemUrl">,
	episode: Episode,
	source: PublishedTranscript,
	signal: AbortSignal,
): Promise<ParsedTranscript> {
	const url = feeds.itemUrl(source.key, source.reference);
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
	const parsed = parseTranscript(source.format, text);
	if (!parsed) {
		throw new PublishedTranscriptError("The published transcript could not be read.");
	}
	const [, transcript] = withoutPrivateFeedAddresses([episode, parsed] as const);
	return isCredentialBearingUrl(url)
		? redactPrivateFeedAddresses(
				transcript,
				new Map([[url, privateFeedPlaceholder(source.key)]]),
			)
		: transcript;
}
