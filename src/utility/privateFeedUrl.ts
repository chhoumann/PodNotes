/**
 * Private (credentialed) podcast feeds embed a durable secret in their URL -
 * userinfo (`user:pass@`) or an auth-bearing query parameter (Patreon's
 * `?auth=...` and similar). Persisting such a URL in data.json leaks the
 * secret through vault sync, git-versioned vaults, and shared vaults.
 *
 * Private feeds therefore persist a placeholder in `PodcastFeed.url` and keep
 * the real URL in Obsidian's vault-local SecretStorage, referenced by
 * `PodcastFeed.urlSecretId`. The placeholder deliberately uses a non-http
 * scheme: if it ever reaches the network gate unresolved, the gate refuses it.
 */

const PLACEHOLDER_SCHEME = "podnotes-private-feed:";

/**
 * Query parameter names that carry a durable subscriber secret. Matched on the
 * whole name, case-insensitively. Path-embedded tokens (Supercast-style) are
 * indistinguishable from public URLs and are NOT detected; those feeds keep
 * working, their URL just stays in data.json like before.
 */
const SECRET_QUERY_PARAM =
	/^(auth|token|key|secret|pass|password|apikey|api[-_]key|access[-_]token|sig|signature|jwt|credential|credentials)$/i;

export function isCredentialBearingUrl(rawUrl: string): boolean {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		return false;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return false;
	if (url.username.length > 0 || url.password.length > 0) return true;
	for (const name of url.searchParams.keys()) {
		if (SECRET_QUERY_PARAM.test(name)) return true;
	}
	return false;
}

/**
 * The persisted stand-in for a private feed's URL. Carries the feed's saved
 * name (its savedFeeds key) so links and the URI handler can find the feed
 * locally and resolve the real URL from SecretStorage - the name is identity,
 * not a secret.
 */
export function privateFeedPlaceholder(podcastName: string): string {
	return `${PLACEHOLDER_SCHEME}${encodeURIComponent(podcastName)}`;
}

export function isPrivateFeedPlaceholder(value: string): boolean {
	return value.startsWith(PLACEHOLDER_SCHEME);
}

/** The savedFeeds key encoded in a placeholder, or null when not a placeholder. */
export function parsePrivateFeedPlaceholder(value: string): string | null {
	if (!isPrivateFeedPlaceholder(value)) return null;
	try {
		return decodeURIComponent(value.slice(PLACEHOLDER_SCHEME.length));
	} catch {
		return null;
	}
}
