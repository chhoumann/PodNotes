/**
 * SSRF guard for every fetch whose URL comes from untrusted feed/URI content.
 *
 * Podcast enclosure URLs (`<enclosure url="...">`) and `obsidian://podnotes`
 * deep-link URLs are fully attacker-controlled, yet they flow straight into
 * Obsidian's `requestUrl`. Before issuing any such request we:
 *   - require an http(s) scheme, so a feed can't make the client read a local
 *     file (`file:`), inline a payload (`data:`/`blob:`), or hit a non-HTTP
 *     service (`ftp:`, ...); and
 *   - reject hosts that resolve to loopback / link-local / private / cloud-metadata
 *     ranges, so a feed can't turn the client into a blind SSRF proxy against
 *     127.0.0.1, 169.254.169.254, or the user's intranet.
 *
 * This applies the same http(s)-only check the project already uses for the
 * chapters URL (`isSupportedChaptersUrl` in fetchChapters.ts) and for feed-add
 * (`PodcastQueryGrid.svelte`), and additionally filters the host, for the
 * download/feed/URI fetch paths.
 *
 * Limitations (both inherent to validating a URL string ahead of an opaque
 * `requestUrl`):
 *   - DNS rebinding: a public hostname that resolves to a private/loopback IP is
 *     allowed, because this checks the literal host, not the resolved address.
 *   - Redirects: `requestUrl` follows them, and an allowed http(s) host could 302
 *     into a blocked range, which cannot be re-checked per hop here.
 * The scheme allowlist (the `file:`/`data:` local-read/exfil vector) is unaffected
 * by both.
 */
export class UnsafeFetchUrlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsafeFetchUrlError";
	}
}

/**
 * Validates that `rawUrl` is safe to fetch and returns the parsed URL.
 * Throws {@link UnsafeFetchUrlError} for an unparseable URL, a non-http(s)
 * scheme, or a host in a blocked (loopback/link-local/private/metadata) range.
 */
export function assertFetchableUrl(rawUrl: string): URL {
	const trimmed = rawUrl?.trim() ?? "";
	if (!trimmed) {
		throw new UnsafeFetchUrlError("Refusing to fetch an empty URL.");
	}

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new UnsafeFetchUrlError(`Refusing to fetch a malformed URL: ${rawUrl}`);
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new UnsafeFetchUrlError(
			`Refusing to fetch a non-http(s) URL (${url.protocol}): ${rawUrl}`,
		);
	}

	if (isBlockedHost(url.hostname)) {
		throw new UnsafeFetchUrlError(
			`Refusing to fetch a loopback/private/link-local address: ${url.hostname}`,
		);
	}

	return url;
}

/** Non-throwing companion to {@link assertFetchableUrl}. */
export function isFetchableUrl(rawUrl: string): boolean {
	try {
		assertFetchableUrl(rawUrl);
		return true;
	} catch {
		return false;
	}
}

function isBlockedHost(hostname: string): boolean {
	// Drop a single trailing dot: "localhost." / "intranet.host." is the absolute
	// FQDN form and resolves to the same address as the dotless name, so it must be
	// classified the same. (The URL parser already strips it from IPv4 literals,
	// but not from registrable names.)
	const host = hostname.toLowerCase().replace(/\.$/, "");

	// Names that always mean the local machine, regardless of DNS.
	if (host === "localhost" || host.endsWith(".localhost")) return true;

	// IPv6 literals keep their brackets in URL.hostname (e.g. "[::1]").
	if (host.startsWith("[") && host.endsWith("]")) {
		const groups = parseIpv6(host.slice(1, -1));
		return groups !== null && isBlockedIpv6(groups);
	}

	// The WHATWG URL parser normalizes every IPv4 form (decimal, octal, hex,
	// integer) to dotted-decimal, so this single check also covers obfuscated
	// literals like http://2130706433/ or http://0x7f.1/.
	const octets = parseIpv4(host);
	if (octets) return isBlockedIpv4(octets);

	return false;
}

function parseIpv4(host: string): number[] | null {
	const parts = host.split(".");
	if (parts.length !== 4) return null;

	const octets: number[] = [];
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const value = Number.parseInt(part, 10);
		if (value > 255) return null;
		octets.push(value);
	}
	return octets;
}

function isBlockedIpv4(octets: number[]): boolean {
	const [a, b] = octets;
	return (
		a === 0 || // 0.0.0.0/8 "this host"
		a === 127 || // 127.0.0.0/8 loopback
		a === 10 || // 10.0.0.0/8 private
		(a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 private
		(a === 192 && b === 168) || // 192.168.0.0/16 private
		(a === 169 && b === 254) // 169.254.0.0/16 link-local (incl. cloud metadata)
	);
}

/** Expand an IPv6 literal (no brackets) to its eight 16-bit groups. */
function parseIpv6(input: string): number[] | null {
	// Drop any zone id ("fe80::1%eth0").
	const zone = input.indexOf("%");
	let addr = zone === -1 ? input : input.slice(0, zone);

	// An embedded dotted-quad in the final group ("::ffff:127.0.0.1") becomes
	// two hex groups so the rest of the parser only deals in hextets.
	const lastColon = addr.lastIndexOf(":");
	const tail = addr.slice(lastColon + 1);
	if (tail.includes(".")) {
		const v4 = parseIpv4(tail);
		if (!v4) return null;
		const high = ((v4[0] << 8) | v4[1]).toString(16);
		const low = ((v4[2] << 8) | v4[3]).toString(16);
		addr = `${addr.slice(0, lastColon + 1)}${high}:${low}`;
	}

	const halves = addr.split("::");
	if (halves.length > 2) return null;

	const left = toGroups(halves[0]);
	const right = halves.length === 2 ? toGroups(halves[1]) : [];
	if (!left || !right) return null;

	if (halves.length === 2) {
		const missing = 8 - left.length - right.length;
		if (missing < 1) return null; // "::" must stand for at least one zero group
		return [...left, ...Array.from({ length: missing }, () => 0), ...right];
	}

	return left.length === 8 ? left : null;
}

function toGroups(segment: string): number[] | null {
	if (segment === "") return [];
	const groups: number[] = [];
	for (const part of segment.split(":")) {
		if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
		groups.push(Number.parseInt(part, 16));
	}
	return groups;
}

function isBlockedIpv6(g: number[]): boolean {
	// fc00::/7 unique-local.
	if ((g[0] & 0xfe00) === 0xfc00) return true;
	// fe80::/10 link-local.
	if ((g[0] & 0xffc0) === 0xfe80) return true;

	// IPv4-mapped ("::ffff:a.b.c.d") and IPv4-compatible ("::a.b.c.d", which also
	// covers ::1 loopback and :: unspecified): fold the trailing 32 bits back into
	// an IPv4 address and reuse the IPv4 ranges.
	const firstFiveZero = g.slice(0, 5).every((part) => part === 0);
	if (firstFiveZero && (g[5] === 0xffff || g[5] === 0)) {
		const v4 = [g[6] >> 8, g[6] & 0xff, g[7] >> 8, g[7] & 0xff];
		return isBlockedIpv4(v4);
	}

	return false;
}
