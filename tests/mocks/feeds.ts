import { vi } from "vitest";
import type { ParsedEpisodeDocument, ParsedFeedEpisodes } from "src/parser/feedDocumentParser";
import type { FeedCacheStorage } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";

/** App#loadLocalStorage and App#saveLocalStorage over a Map. */
export class MemoryStorage implements FeedCacheStorage {
	readonly values = new Map<string, unknown>();

	loadLocalStorage(key: string): unknown {
		return this.values.get(key) ?? null;
	}

	saveLocalStorage(key: string, value: unknown): void {
		if (value === null) this.values.delete(key);
		else this.values.set(key, value);
	}
}

/**
 * Stands in for `window.localStorage`, where feed caches before v5 lived, so a
 * Node test can build a FeedRepository. Undo it with `vi.unstubAllGlobals()`.
 */
export function stubLegacyStorage(): Map<string, string> {
	const legacy = new Map<string, string>();
	vi.stubGlobal("window", {
		localStorage: { removeItem: (key: string) => legacy.delete(key) },
	});
	return legacy;
}

/** The parsed feed whose projection for a subscription yields `episodes`. */
export function feedDocument(title: string, episodes: readonly Episode[]): ParsedFeedEpisodes {
	return { feed: { title }, episodes: episodes.map(feedItem) };
}

export function feedItem(episode: Episode): ParsedEpisodeDocument {
	return {
		title: episode.title,
		streamUrl: episode.streamUrl,
		guid: episode.guid,
		itemLink: episode.url,
		description: episode.description,
		content: episode.content,
		artworkUrl: episode.artworkUrl,
		episodeDate: episode.episodeDate,
		mediaType: episode.mediaType ?? "audio",
	};
}

/** A promise the test settles by hand, to order responses. */
export function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
