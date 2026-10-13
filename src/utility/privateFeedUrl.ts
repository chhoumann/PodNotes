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

import checkStringIsUrl from "./checkStringIsUrl";

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

/**
 * `url` as a request sends it, so the scheme and host in any case, and with or
 * without a default port, name the same feed. As given when it is not a URL.
 */
export function canonicalUrl(url: string): string {
	return checkStringIsUrl(url)?.href ?? url;
}

/**
 * `document` with no private feed address left in it. A snapshot's
 * credential-bearing `feedUrl` is a private feed address, as is each key of
 * `known` (saved private feeds' real URLs, mapped to their placeholders). Every
 * string anywhere that is one of these addresses, or quotes one as written,
 * gets its placeholder instead, so the address cannot stay behind in a
 * description or a field this version does not know. Signed media and an
 * episode's own link are other URLs and stay as they are. Returns `document`
 * itself when nothing changed; never mutates it.
 */
export function redactPrivateFeedAddresses<T>(
	document: T,
	known: ReadonlyMap<string, string> = new Map(),
): T {
	const placeholders = new Map<string, string>();
	const add = (url: string, placeholder: string) => {
		const canonical = canonicalUrl(url).split("#")[0];
		const kept = placeholders.get(canonical) ?? placeholder;
		placeholders.set(canonical, kept);
	};
	for (const [url, placeholder] of known) add(url, placeholder);
	const credentialed = new Map<string, boolean>();
	visitRecords(document, ({ feedUrl, podcastName }) => {
		if (typeof feedUrl !== "string" || isPrivateFeedPlaceholder(feedUrl)) return;
		let isPrivate = credentialed.get(feedUrl);
		if (isPrivate === undefined) {
			isPrivate = isCredentialBearingUrl(feedUrl);
			credentialed.set(feedUrl, isPrivate);
		}
		if (!isPrivate) return;
		add(feedUrl, privateFeedPlaceholder(typeof podcastName === "string" ? podcastName : ""));
	});
	if (placeholders.size === 0) return document;
	const hosts = [
		...new Set([...placeholders.keys()].map((address) => new URL(address).hostname)),
	];
	// Encoded, numeric and non-ASCII authorities can normalize to a known host too.
	const candidate = new RegExp(
		hosts.map((host) => host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") +
			String.raw`|https?:\/\/[^\s/?#]*[%\\\[\u0080-\uFFFF]|https?:\/\/(?:[^\s/?#@]*@)?[\d/\\]`,
		"i",
	);
	const matches = new Map<string, string | undefined>();
	const lookup = (address: string) => {
		if (matches.has(address)) return matches.get(address);
		const replacement = placeholders.get(canonicalUrl(address).split("#")[0]);
		matches.set(address, replacement);
		return replacement;
	};
	return replaceStrings(document, (value) => {
		if (!value.includes("://") || !candidate.test(value)) return value;
		if (/^https?:\/\/[^\s<>"'`]+$/i.test(value)) return lookup(value) ?? value;
		return value.replace(/https?:\/\/[^\s<>"'`]+/gi, (address) => {
			const whole = lookup(address);
			if (whole) return whole;
			const bare = address.replace(/[.,;:!?)\]}]+$/, "");
			const replacement = lookup(bare);
			return replacement ? replacement + address.slice(bare.length) : address;
		});
	});
}

function isPlainObjectOrArray(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value) as object | null;
	return Array.isArray(value) || prototype === Object.prototype || prototype === null;
}

function visitRecords(value: unknown, visit: (record: Record<string, unknown>) => void): void {
	if (!isPlainObjectOrArray(value)) return;
	if (!Array.isArray(value)) visit(value);
	for (const key in value) {
		if (Object.prototype.hasOwnProperty.call(value, key) && typeof value[key] === "object")
			visitRecords(value[key], visit);
	}
}

function replaceStrings<T>(value: T, replace: (value: string) => string): T {
	if (typeof value === "string") return replace(value) as T;
	if (!isPlainObjectOrArray(value)) return value;
	if (Array.isArray(value)) {
		let copy: unknown[] | undefined;
		for (let i = 0; i < value.length; i++) {
			const replaced = replaceStrings(value[i], replace);
			if (replaced !== value[i]) {
				copy ??= value.slice();
				copy[i] = replaced;
			}
		}
		return (copy ?? value) as T;
	}
	let copy: Record<string, unknown> | undefined;
	for (const key of Object.keys(value)) {
		const entry = value[key];
		const replacedKey = replace(key);
		if (
			replacedKey !== key &&
			(Object.prototype.hasOwnProperty.call(value, replacedKey) ||
				(copy && Object.prototype.hasOwnProperty.call(copy, replacedKey)))
		) {
			throw new Error("Private feed address protection would overwrite a saved field.");
		}
		const replaced = replaceStrings(entry, replace);
		if (replacedKey !== key || replaced !== entry) {
			if (!copy) {
				copy = { ...value };
				Object.setPrototypeOf(copy, Object.getPrototypeOf(value));
			}
			if (replacedKey !== key) delete copy[key];
			Object.defineProperty(copy, replacedKey, {
				value: replaced,
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
	}
	return (copy ?? value) as T;
}
