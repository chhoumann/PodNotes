import { fetchTextWithTimeout } from "src/utility/networkRequest";

const FEED_REQUEST_TIMEOUT_MS = 30_000;
const MAX_FEED_DOCUMENT_BYTES = 16 * 1024 * 1024;

/** Retrieval port for the legacy target-shaped feed parser. */
export interface FeedDocumentSource {
	load(sourceUrl: string): Promise<string>;
}

/**
 * Current Obsidian compatibility source.
 *
 * `requestUrl` does not expose redirect hops, the final URL, DNS answers, the
 * connected peer, or native cancellation. Callers must not infer those
 * guarantees from this adapter.
 */
export const legacyObsidianFeedDocumentSource: FeedDocumentSource = Object.freeze({
	async load(sourceUrl: string): Promise<string> {
		return fetchTextWithTimeout(sourceUrl, {
			timeoutMs: FEED_REQUEST_TIMEOUT_MS,
			maxResponseBytes: MAX_FEED_DOCUMENT_BYTES,
			acceptedStatuses: [200],
		});
	},
});
