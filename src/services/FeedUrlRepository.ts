import type { SecretStorage } from "obsidian";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { isValidSecretId } from "src/types/Credentials";

/**
 * Vault-local storage for private feed URLs, following CredentialRepository's
 * contract: runtime reads fail closed and never cache secret values; writes
 * return an ID only after the exact value reads back.
 *
 * SecretStorage is device-local, so a second synced device sees the feed's
 * placeholder without its secret - the feed is re-added there. IDs are
 * content-free (`podnotes-feed-url`, `-2`, `-3`, ...) so neither the feed name
 * nor the URL leaks through the ID namespace, which `listSecrets` exposes.
 */
const BASE_ID = "podnotes-feed-url";
const FEED_URL_SECRET_ID = /^podnotes-feed-url(?:-[1-9]\d*)?$/;

export function isFeedUrlSecretId(value: string): boolean {
	return FEED_URL_SECRET_ID.test(value);
}

export class FeedUrlRepository {
	constructor(private readonly storage: SecretStorage) {}

	/** The real feed URL, or null when the reference is invalid or absent on this device. */
	resolve(urlSecretId: string): string | null {
		const id = urlSecretId.trim();
		if (!id || !isFeedUrlSecretId(id) || !isValidSecretId(id)) return null;
		try {
			const value = this.storage.getSecret(id);
			return value?.trim() ? value.trim() : null;
		} catch (error) {
			console.error("PodNotes: failed to read a private feed URL", error);
			return null;
		}
	}

	/**
	 * Store a private feed URL under a PodNotes-owned ID. An existing identical
	 * value is reused (idempotent retries); a conflicting value is never
	 * overwritten - the first free numeric suffix is used instead.
	 */
	store(url: string): string {
		const value = url.trim();
		if (!value) throw new Error("A private feed URL must not be empty.");

		for (let suffix = 1; suffix <= 10_000; suffix++) {
			const id = suffix === 1 ? BASE_ID : `${BASE_ID}-${suffix}`;
			const existing = this.storage.getSecret(id);

			if (existing === value) return id;
			if (existing !== null && existing !== "") continue;

			this.storage.setSecret(id, value);
			if (this.storage.getSecret(id) !== value) {
				throw new Error("SecretStorage did not retain the private feed URL.");
			}
			return id;
		}

		throw new Error("Could not allocate a SecretStorage ID for the private feed URL.");
	}

	/** Clearing to "" is SecretStorage's deletion idiom; reads treat "" as absent. */
	delete(urlSecretId: string): void {
		const id = urlSecretId.trim();
		if (!id || !isFeedUrlSecretId(id)) return;
		try {
			this.storage.setSecret(id, "");
		} catch (error) {
			console.error("PodNotes: failed to delete a private feed URL", error);
		}
	}

	/**
	 * Delete every PodNotes-owned feed-url secret no saved feed references.
	 * Covers removals that bypassed the remove flow (e.g. a settings import
	 * replacing savedFeeds wholesale).
	 */
	sweepOrphans(feeds: Record<string, PodcastFeed>): void {
		const referenced = new Set<string>();
		for (const feed of Object.values(feeds)) {
			if (feed.urlSecretId) referenced.add(feed.urlSecretId);
		}
		let ids: string[];
		try {
			ids = this.storage.listSecrets();
		} catch (error) {
			console.error("PodNotes: failed to list secrets for the orphan sweep", error);
			return;
		}
		for (const id of ids) {
			if (!isFeedUrlSecretId(id) || referenced.has(id)) continue;
			if (!this.storage.getSecret(id)) continue;
			this.delete(id);
		}
	}
}
