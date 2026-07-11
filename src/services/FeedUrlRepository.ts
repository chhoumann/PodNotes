import type { SecretStorage } from "obsidian";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { isValidSecretId } from "src/types/Credentials";

/**
 * Vault-local storage for private feed URLs, following CredentialRepository's
 * contract: runtime reads fail closed and never cache secret values; writes
 * return an ID only after the exact value reads back.
 *
 * IDs are `podnotes-feed-url-<uuid>`. The UUID matters: `urlSecretId`
 * references sync through data.json while SecretStorage stays device-local,
 * so IDs must never collide across devices. With sequential IDs, device A's
 * synced reference could resolve on device B to an UNRELATED feed's secret
 * and silently fetch the wrong private feed; with UUIDs a foreign reference
 * simply misses and the user re-adds the feed. Content-free by construction -
 * neither the feed name nor the URL leaks through the ID namespace, which
 * `listSecrets` exposes.
 */
const FEED_URL_SECRET_ID =
	/^podnotes-feed-url-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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

	/** Store a private feed URL under a fresh PodNotes-owned ID and verify the readback. */
	store(url: string): string {
		const value = url.trim();
		if (!value) throw new Error("A private feed URL must not be empty.");

		const id = `podnotes-feed-url-${crypto.randomUUID()}`;
		this.storage.setSecret(id, value);
		if (this.storage.getSecret(id) !== value) {
			throw new Error("SecretStorage did not retain the private feed URL.");
		}
		return id;
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
	 * replacing savedFeeds wholesale). Never throws: a sweep failure must not
	 * abort plugin loading.
	 */
	sweepOrphans(feeds: Record<string, PodcastFeed>): void {
		const referenced = new Set<string>();
		for (const feed of Object.values(feeds)) {
			// Trim to match resolve(): a reference that resolves must also protect
			// its secret from the sweep.
			if (feed.urlSecretId?.trim()) referenced.add(feed.urlSecretId.trim());
		}
		try {
			for (const id of this.storage.listSecrets()) {
				if (!isFeedUrlSecretId(id) || referenced.has(id)) continue;
				if (!this.storage.getSecret(id)) continue;
				this.delete(id);
			}
		} catch (error) {
			console.error("PodNotes: the private feed URL orphan sweep failed", error);
		}
	}
}
