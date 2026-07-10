import { requestWithTimeout } from "src/utility/networkRequest";

/** Retrieval port for the legacy target-shaped feed parser. */
export interface FeedDocumentSource {
	load(sourceUrl: string): Promise<string>;
}

/**
 * Current Obsidian compatibility source.
 *
 * This is deliberately named legacy: `requestUrl` does not expose DNS pinning,
 * the connected peer, redirect hops, or native cancellation, so it must never
 * be presented as a `PinnedNetworkHopAdapter` or as equivalent to the
 * capability-scoped transport.
 */
export const legacyObsidianFeedDocumentSource: FeedDocumentSource = Object.freeze({
	async load(sourceUrl: string): Promise<string> {
		const response = await requestWithTimeout(sourceUrl, { timeoutMs: 30_000 });
		return response.text;
	},
});
