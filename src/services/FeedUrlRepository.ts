import type { SecretStorage } from "obsidian";
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
 * and silently fetch the wrong private feed. With UUIDs a reference misses on
 * a device until its user sets the feed's address there, under the same ID, so
 * one reference names each device's own copy. Content-free by construction -
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
		const id = `podnotes-feed-url-${crypto.randomUUID()}`;
		this.attach(id, url);
		return id;
	}

	/**
	 * Store a private feed URL under `urlSecretId`, a reference data.json already
	 * holds, and verify the readback. Refuses an ID PodNotes does not own, and a
	 * slot that holds another URL on this device.
	 */
	attach(urlSecretId: string, url: string): void {
		const id = urlSecretId.trim();
		const value = url.trim();
		if (!isFeedUrlSecretId(id) || !isValidSecretId(id)) {
			throw new Error("Not a PodNotes private feed reference.");
		}
		if (!value) throw new Error("A private feed URL must not be empty.");
		const current = this.storage.getSecret(id)?.trim();
		if (current && current !== value) {
			throw new Error("This device holds another URL for this private feed.");
		}
		this.storage.setSecret(id, value);
		if (this.storage.getSecret(id) !== value) {
			throw new Error("SecretStorage did not retain the private feed URL.");
		}
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
	 * Delete every PodNotes-owned feed-url secret none of `documents` references
	 * anywhere, so an ID in a record this version could not read, or in a field it
	 * does not know, keeps its secret. Covers removals that bypassed the remove
	 * flow (e.g. a settings import replacing savedFeeds wholesale). Never throws:
	 * a sweep failure must not abort plugin loading.
	 */
	sweepOrphans(...documents: unknown[]): void {
		const referenced = new Set<string>();
		const collect = (value: unknown): void => {
			if (typeof value === "string") {
				if (isFeedUrlSecretId(value.trim())) referenced.add(value.trim());
			} else if (typeof value === "object" && value !== null) {
				for (const [key, entry] of Object.entries(value)) {
					collect(key);
					collect(entry);
				}
			}
		};
		for (const document of documents) collect(document);
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
