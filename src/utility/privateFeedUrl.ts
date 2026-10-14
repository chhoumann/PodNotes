/**
 * Private (credentialed) podcast feeds embed a durable secret in their URL -
 * userinfo (`user:pass@`), an auth-bearing query parameter (Patreon's
 * `?auth=...` and similar), or, on a few publishers' hosts, the path.
 * Persisting such a URL in data.json leaks the secret through vault sync,
 * git-versioned vaults, and shared vaults.
 *
 * Private feeds therefore persist a placeholder in `PodcastFeed.url` and keep
 * the real URL in Obsidian's vault-local SecretStorage, referenced by
 * `PodcastFeed.urlSecretId`. The placeholder deliberately uses a non-http
 * scheme: if it ever reaches the network gate unresolved, the gate refuses it.
 */

import checkStringIsUrl from "./checkStringIsUrl";
import { COMMON_NAMED_ENTITIES } from "./htmlEntities";

const PLACEHOLDER_SCHEME = "podnotes-private-feed:";

/**
 * Query parameter names that carry a durable subscriber secret. Matched on the
 * whole name, case-insensitively.
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
	return isPublisherPrivateFeed(url);
}

function isPublisherPrivateFeed({ hostname, pathname, searchParams }: URL): boolean {
	const host = hostname.replace(/\.$/, "");
	// https://supercast.readme.io/reference/getsubscriber (/feed/<key>.rss) and
	// https://github.com/Podcastindex-org/private-feed-blocklist/pull/2 (/feeds/)
	if (isWithin(host, "supercast.com") || isWithin(host, "supercast.tech"))
		return /^\/feed\/[^/]+\.rss$/.test(pathname) || /^\/feeds\/[^/]+/.test(pathname);
	// https://support.substack.com/hc/en-us/articles/360041722272-Will-my-Podcast-RSS-feed-show-paid-only-content
	// https://forums.pocketcasts.com/forums/topic/a-private-rss-feed-has-stopped-showing-me-new-episodes/
	if (isWithin(host, "substack.com"))
		return /^\/feed\/podcast\/\d+(\/s\/\d+)?\/private\/[^/]+\.rss$/.test(pathname);
	// https://developers.supportingcast.fm/api/docs-v2-source (UserFeed.url)
	if (host.endsWith(".supportingcast.fm")) return /^\/content\/[^/]+\.rss$/.test(pathname);
	// https://developers.transistor.fm/ (subscriber feed_url)
	if (host === "subscribers.transistor.fm") return /^\/[^/]+/.test(pathname);
	// https://help.pinecast.com/article/61-subscribing-to-a-private-rss-feed
	if (host === "pinecast.com") return /^\/feed\/[^/]+\/sub\/[^/]+/.test(pathname);
	// https://github.com/Podcastindex-org/private-feed-blocklist/issues/1
	if (host === "private.captivate.fm") return /^\/[^/]+/.test(pathname);
	// https://github.com/Podcastindex-org/private-feed-blocklist/pull/5
	if (host === "feeds.redcircle.com") return /^\/[^/]+\/pf\/[^/]+/.test(pathname);
	if (host === "api.podcache.net") return /^\/shows\/[^/]+\/pf\/[^/]+/.test(pathname);
	// https://github.com/Podcastindex-org/private-feed-blocklist/pull/4
	if (host.endsWith(".castos.com")) return Boolean(searchParams.get("uuid"));
	return false;
}

function isWithin(host: string, domain: string): boolean {
	return host === domain || host.endsWith(`.${domain}`);
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

export function canonicalUrl(url: string): string {
	const parsed = checkStringIsUrl(url);
	if (!parsed) return url;
	parsed.hostname = parsed.hostname.replace(/\.$/, "");
	return parsed.href;
}

function redactionKey(address: string): string | undefined {
	const url = checkStringIsUrl(address);
	if (!url || !/^https?:$/.test(url.protocol)) return undefined;
	url.protocol = "https:";
	url.hostname = url.hostname.replace(/\.$/, "");
	url.hash = "";
	return url.href;
}

const HTML_ENTITY = /&(?:#(x[\da-f]+|\d+);?|([a-z]+);)/gi;
// HTML also spells lt, gt and quot in capitals. decodeHtml takes amp in any case, so
// an address escaped with a malformed &aMp; still matches its known address.
const NAMED_ENTITIES = new Map(
	Object.entries({
		...COMMON_NAMED_ENTITIES,
		LT: "<",
		GT: ">",
		QUOT: '"',
		colon: ":",
		sol: "/",
		period: ".",
		quest: "?",
		equals: "=",
		num: "#",
		percnt: "%",
		lowbar: "_",
		commat: "@",
		plus: "+",
	}),
);

type Entity = [decodedStart: number, decodedEnd: number, sourceStart: number, sourceEnd: number];

function decodeHtml(value: string): [text: string, entities: Entity[]] {
	const entities: Entity[] = [];
	if (!value.includes("&")) return [value, entities];
	let shift = 0;
	const text = value.replace(
		HTML_ENTITY,
		(entity: string, code: string | undefined, name: string | undefined, from: number) => {
			const char = code
				? String.fromCodePoint(
						Math.min(Number(/^x/i.test(code) ? `0${code}` : code), 0x10ffff),
					)
				: NAMED_ENTITIES.get(name?.toLowerCase() === "amp" ? "amp" : (name ?? ""));
			if (char === undefined) return entity;
			entities.push([from - shift, from - shift + char.length, from, from + entity.length]);
			shift += entity.length - char.length;
			return char;
		},
	);
	return [text, entities];
}

function sourceIndex(entities: Entity[], index: number): number {
	let shift = 0;
	for (const [at, end, from, to] of entities) {
		if (index <= at) break;
		if (index < end) return from;
		shift = to - end;
	}
	return index + shift;
}

const ADDRESS_START =
	/(podnotes-private-feed:[\w.!~*'()%-]*)|(https?%3a)|(?:feed|podcast|https?):|(?:^|[^\w.@/\\:%-])(?=([\w.-]+)[/?#:])/gi;
const ADDRESS = /[^\s<>"'`]+/y;
const ENCODED_ADDRESS = /[^\s<>"'`&#]+/y;
// Encoded, numeric and non-ASCII authorities can normalize to a known host too.
const UNUSUAL_AUTHORITY = /^https?:[/\\]*(?:[^/?#]*[%\\[\u0080-\uFFFF]|(?:[^/?#@]*@)?\d)/i;
// A string the scan can redact holds one of these, or a known host.
const ESCAPED_OR_UNUSUAL = /[&%@\\[\u0080-\uFFFF]|(?:https?|feed|podcast):\/*\d/i;

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
		const key = redactionKey(url);
		if (key && !placeholders.has(key)) placeholders.set(key, placeholder);
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
	const hosts = [...new Set([...placeholders.keys()].map((key) => new URL(key).hostname))];
	// URL normalization keeps trailing punctuation, so a run longer than the
	// longest address cannot end one.
	const longest = Math.max(...[...placeholders.keys()].map((key) => key.length));
	const matches = new Map<string, string | undefined>();
	const lookup = (address: string) => {
		if (!matches.has(address)) {
			const key = redactionKey(address);
			matches.set(address, key && placeholders.get(key));
		}
		return matches.get(address);
	};
	const spelledAddress = (quote: string, encoded: boolean) => {
		if (!encoded)
			return quote.replace(/^(?:feed|podcast):/i, "").replace(/^(?!https?:)\/*/i, "https://");
		try {
			return decodeURIComponent(quote);
		} catch {
			return "";
		}
	};
	const matchAddress = (quote: string, encoded: boolean, isWholeString: boolean) => {
		const spelled = spelledAddress(quote, encoded);
		const lower = spelled.toLowerCase();
		if (!hosts.some((host) => lower.includes(host)) && !UNUSUAL_AUTHORITY.test(spelled)) return;
		let bare = quote.length;
		while (!isWholeString && bare > 0 && ".,;:!?)]}".includes(quote[bare - 1])) bare--;
		for (let end = bare; end <= Math.min(quote.length, bare + longest); end++) {
			const placeholder = lookup(spelledAddress(quote.slice(0, end), encoded));
			if (placeholder)
				return { end, text: encoded ? encodeURIComponent(placeholder) : placeholder };
		}
	};
	const redactText = (value: string) => {
		const [text, entities] = decodeHtml(value);
		let redacted = "";
		let copied = 0;
		// A failed address still gets searched for an encoded one in its query.
		let failedUntil = 0;
		ADDRESS_START.lastIndex = 0;
		for (let match; (match = ADDRESS_START.exec(text));) {
			const [start, placeholder, encodedScheme, host] = match;
			// A host name at the very start matches empty.
			if (!start) ADDRESS_START.lastIndex++;
			const at = match.index + (host === undefined ? 0 : start.length);
			if (placeholder || (host !== undefined && !hosts.includes(host.toLowerCase())))
				continue;
			if (!encodedScheme && at < failedUntil) continue;
			const extent = encodedScheme ? ENCODED_ADDRESS : ADDRESS;
			extent.lastIndex = at;
			extent.test(text);
			const end = extent.lastIndex;
			const found = matchAddress(
				text.slice(at, end),
				Boolean(encodedScheme),
				at === 0 && end === text.length,
			);
			if (found) {
				redacted += value.slice(copied, sourceIndex(entities, at)) + found.text;
				copied = sourceIndex(entities, at + found.end);
				ADDRESS_START.lastIndex = at + found.end;
			} else if (encodedScheme) {
				ADDRESS_START.lastIndex = end;
			} else {
				failedUntil = end;
			}
		}
		return copied ? redacted + value.slice(copied) : value;
	};
	const mayQuote = (value: string) => {
		if (ESCAPED_OR_UNUSUAL.test(value)) return true;
		const lower = value.toLowerCase();
		return hosts.some((host) => lower.includes(host));
	};
	const results = new Map<string, string>();
	return replaceStrings(document, (value) => {
		let result = results.get(value);
		if (result === undefined) {
			result = mayQuote(value) ? redactText(value) : value;
			results.set(value, result);
		}
		return result;
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
