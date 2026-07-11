import { requestWithTimeout } from "src/utility/networkRequest";

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
		const response = await requestWithTimeout(sourceUrl, { timeoutMs: 30_000 });
		return response.text;
	},
});
