import { isPlainObject } from "src/persistence/codecUtils";
import type { FeedKey, FeedRepository } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import { NetworkError, fetchTextWithTimeout } from "src/utility/networkRequest";
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
	links: unknown,
): PublishedTranscript | undefined {
	let best: { rank: number; reference: string } | undefined;
	for (const link of Array.isArray(links) ? links : []) {
		if (!isPlainObject(link) || typeof link.url !== "string" || typeof link.type !== "string") {
			continue;
		}
		const type = link.type.split(";")[0].trim().toLowerCase();
		const rank = FORMATS_BY_PREFERENCE.findIndex(([, types]) => types.includes(type));
		if (rank >= 0 && (!best || rank < best.rank)) best = { rank, reference: link.url };
	}
	return best && { key, reference: best.reference, format: FORMATS_BY_PREFERENCE[best.rank][0] };
}

export async function findPublishedTranscript(
	feeds: Pick<FeedRepository, "load" | "episodeMetadata">,
	episode: Episode,
): Promise<PublishedTranscript | undefined> {
	const key = episode.podcastName;
	await feeds.load([key], "complete");
	return choosePublishedTranscript(key, feeds.episodeMetadata(key, episode)?.transcripts);
}

export class PublishedTranscriptError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PublishedTranscriptError";
	}
}

export async function fetchPublishedTranscript(
	feeds: Pick<FeedRepository, "itemUrl">,
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
	const transcript = parseTranscript(source.format, text);
	if (!transcript) {
		throw new PublishedTranscriptError("The published transcript could not be read.");
	}
	return transcript;
}
