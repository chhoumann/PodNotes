import { Notice, type SecretStorage } from "obsidian";
import { isValidSecretId } from "src/types/Credentials";

/**
 * Vault-local storage for private feed URLs, following CredentialRepository's
 * contract: stored references resolve from SecretStorage; writes return an ID
 * only after the exact value reads back. Failed moves from data.json can retain
 * the address for this session under a separate, temporary reference.
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
 *
 * SecretStorage cannot delete an ID, only clear its value, so storing a URL
 * this device already holds reuses that ID. Only an ID whose value here is
 * exactly the URL qualifies. A cleared ID stays retired, since another device
 * may still reference it.
 */
const FEED_URL_SECRET_ID =
	/^podnotes-feed-url-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isFeedUrlSecretId(value: string): boolean {
	return FEED_URL_SECRET_ID.test(value);
}

export class FeedUrlRepository {
	private readonly sessionUrls = new Map<string, string>();
	private warnedAboutStorage = false;

	constructor(private readonly storage: SecretStorage) {}

	/** The real feed URL, or null when the reference is invalid or absent on this device. */
	resolve(urlSecretId: string): string | null {
		const id = urlSecretId.trim();
		if (!id || !isFeedUrlSecretId(id) || !isValidSecretId(id)) return null;
		const sessionUrl = this.sessionUrls.get(id);
		if (sessionUrl) return sessionUrl;
		try {
			const value = this.storage.getSecret(id);
			return value?.trim() ? value.trim() : null;
		} catch (error) {
			console.error("PodNotes: failed to read a private feed URL", error);
			return null;
		}
	}

	/** Store a private feed URL under its ID here, else a fresh one, and verify the readback. */
	store(url: string): string {
		const value = url.trim();
		const id =
			this.storage
				.listSecrets()
				.find(
					(held) => isFeedUrlSecretId(held) && this.storage.getSecret(held) === value,
				) ?? `podnotes-feed-url-${crypto.randomUUID()}`;
		this.attach(id, url);
		return id;
	}

	/** A failed move still removes the raw URL from disk and works until restart. */
	retainForSession(url: string): string {
		for (const [id, value] of this.sessionUrls) {
			if (value === url) return id;
		}
		const id = `podnotes-feed-url-${crypto.randomUUID()}`;
		this.sessionUrls.set(id, url);
		if (!this.warnedAboutStorage) {
			this.warnedAboutStorage = true;
			new Notice("Could not store the private feed address on this device.");
		}
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
		this.sessionUrls.delete(id);
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
