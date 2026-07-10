const HANDLE_ENTROPY_BYTES = 32;
const HANDLE_HEX_LENGTH = HANDLE_ENTROPY_BYTES * 2;
const FEED_HANDLE_PREFIX = "podnotes-feed-";
const EPISODE_HANDLE_PREFIX = "podnotes-episode-";
const FEED_HANDLE_PATTERN = new RegExp(`^${FEED_HANDLE_PREFIX}[0-9a-f]{${HANDLE_HEX_LENGTH}}$`);
const EPISODE_HANDLE_PATTERN = new RegExp(
	`^${EPISODE_HANDLE_PREFIX}[0-9a-f]{${HANDLE_HEX_LENGTH}}$`,
);

export const HANDLE_ALLOCATION_ATTEMPTS = 16;

declare const feedHandleBrand: unique symbol;
declare const episodeHandleBrand: unique symbol;

export type FeedHandle = string & { readonly [feedHandleBrand]: true };
export type EpisodeHandle = string & { readonly [episodeHandleBrand]: true };
export type FillRandomValues = (bytes: Uint8Array) => void;

export interface HandleAllocationOptions {
	/** Test seam. Production always uses Web Crypto. */
	fillRandom?: FillRandomValues;
	/** Handles already reserved in the destination identity map. */
	unavailable?: ReadonlySet<string>;
}

export class HandleAllocationError extends Error {
	constructor(kind: "feed" | "episode") {
		super(`PodNotes could not allocate a secure ${kind} handle.`);
		this.name = "HandleAllocationError";
	}
}

function fillWithWebCrypto(bytes: Uint8Array): void {
	// oxlint-disable-next-line obsidianmd/no-global-this -- Handles also allocate in non-window migration and test runtimes.
	const crypto = globalThis.crypto;
	if (!crypto || typeof crypto.getRandomValues !== "function") {
		throw new Error("Web Crypto is unavailable");
	}
	crypto.getRandomValues(bytes as Uint8Array<ArrayBuffer>);
}

function encodeLowercaseHex(bytes: Uint8Array): string {
	let encoded = "";
	for (const byte of bytes) encoded += byte.toString(16).padStart(2, "0");
	return encoded;
}

function allocateHandle(
	kind: "feed" | "episode",
	prefix: typeof FEED_HANDLE_PREFIX | typeof EPISODE_HANDLE_PREFIX,
	options: HandleAllocationOptions,
): string {
	const fillRandom = options.fillRandom ?? fillWithWebCrypto;

	for (let attempt = 0; attempt < HANDLE_ALLOCATION_ATTEMPTS; attempt += 1) {
		const bytes = new Uint8Array(HANDLE_ENTROPY_BYTES);
		try {
			fillRandom(bytes);
		} catch {
			throw new HandleAllocationError(kind);
		}

		const candidate = `${prefix}${encodeLowercaseHex(bytes)}`;
		if (!options.unavailable?.has(candidate)) return candidate;
	}

	throw new HandleAllocationError(kind);
}

export function allocateFeedHandle(options: HandleAllocationOptions = {}): FeedHandle {
	return allocateHandle("feed", FEED_HANDLE_PREFIX, options) as FeedHandle;
}

export function allocateEpisodeHandle(options: HandleAllocationOptions = {}): EpisodeHandle {
	return allocateHandle("episode", EPISODE_HANDLE_PREFIX, options) as EpisodeHandle;
}

export function isFeedHandle(value: unknown): value is FeedHandle {
	return typeof value === "string" && FEED_HANDLE_PATTERN.test(value);
}

export function isEpisodeHandle(value: unknown): value is EpisodeHandle {
	return typeof value === "string" && EPISODE_HANDLE_PATTERN.test(value);
}

export function getFeedHandleHex(value: unknown): string | undefined {
	return isFeedHandle(value) ? value.slice(FEED_HANDLE_PREFIX.length) : undefined;
}

export function getEpisodeHandleHex(value: unknown): string | undefined {
	return isEpisodeHandle(value) ? value.slice(EPISODE_HANDLE_PREFIX.length) : undefined;
}
