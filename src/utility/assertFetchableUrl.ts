import { encodeUrlForRequest } from "./encodeUrlForRequest";

/** Maximum UTF-8 size accepted for both raw and encoded network targets. */
export const MAX_NETWORK_TARGET_BYTES = 16 * 1024;

type HostClassification =
	| "ordinary-public-literal"
	| "non-public-or-special-literal"
	| "hostname-requires-resolution";

type LiteralAddressClassification = Exclude<HostClassification, "hostname-requires-resolution">;

type TargetPolicyFailureReason =
	| "empty"
	| "too-large"
	| "malformed"
	| "unsupported-scheme"
	| "unsafe-unicode";

export type UnsafeFetchUrlReason = TargetPolicyFailureReason | "non-public-or-special-host";

interface AddressRange {
	readonly network: bigint;
	readonly prefixLength: number;
}

interface ParsedTargetPolicy {
	readonly url: URL;
	readonly hostClassification: HostClassification;
}

type TargetPolicyResult =
	| { readonly ok: true; readonly value: ParsedTargetPolicy }
	| { readonly ok: false; readonly reason: TargetPolicyFailureReason };

const IPV4_BIT_LENGTH = 32;
const IPV6_BIT_LENGTH = 128;

const IPV4_BLOCKED_RANGES = [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.31.196.0", 24],
	["192.52.193.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["192.175.48.0", 24],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4],
] as const;

const IPV6_BLOCKED_RANGES = [
	["::", 128],
	["::1", 128],
	["64:ff9b::", 96],
	["64:ff9b:1::", 48],
	["100::", 64],
	["100:0:0:1::", 64],
	["2001::", 23],
	["2001:db8::", 32],
	["2002::", 16],
	["2620:4f:8000::", 48],
	["3fff::", 20],
	["5f00::", 16],
	["fc00::", 7],
	["fe80::", 10],
	["fec0::", 10],
	["ff00::", 8],
] as const;

function parseCanonicalIpv4(value: string): bigint | undefined {
	const parts = value.split(".");
	if (parts.length !== 4) return undefined;

	let address = 0n;
	for (const part of parts) {
		if (!/^(?:0|[1-9][0-9]{0,2})$/.test(part)) return undefined;
		const octet = Number(part);
		if (octet > 255) return undefined;
		address = (address << 8n) | BigInt(octet);
	}
	return address;
}

function parseIpv6(value: string): bigint | undefined {
	const candidate = value.toLowerCase();
	if (candidate.length === 0 || candidate.includes("%")) return undefined;

	const compressionIndex = candidate.indexOf("::");
	if (compressionIndex !== -1 && candidate.indexOf("::", compressionIndex + 2) !== -1) {
		return undefined;
	}

	const parseSide = (side: string): string[] | undefined => {
		if (side.length === 0) return [];
		const pieces = side.split(":");
		if (pieces.some((piece) => piece.length === 0)) return undefined;
		return pieces;
	};

	const left = parseSide(
		compressionIndex === -1 ? candidate : candidate.slice(0, compressionIndex),
	);
	const right = parseSide(compressionIndex === -1 ? "" : candidate.slice(compressionIndex + 2));
	if (!left || !right) return undefined;

	const sideWithLastPiece = right.length > 0 ? right : left;
	const lastPiece = sideWithLastPiece[sideWithLastPiece.length - 1];
	if (lastPiece?.includes(".")) {
		// An embedded dotted quad is the final 32 bits of an IPv6 spelling. It
		// cannot precede a trailing compression marker such as 192.0.2.1::.
		if (compressionIndex !== -1 && right.length === 0) return undefined;
		const ipv4 = parseCanonicalIpv4(lastPiece);
		if (ipv4 === undefined) return undefined;
		sideWithLastPiece.splice(
			sideWithLastPiece.length - 1,
			1,
			Number((ipv4 >> 16n) & 0xffffn).toString(16),
			Number(ipv4 & 0xffffn).toString(16),
		);
	}

	const combined = [...left, ...right];
	if (combined.some((piece) => piece.includes("."))) return undefined;
	if (combined.some((piece) => !/^[0-9a-f]{1,4}$/.test(piece))) return undefined;
	if (compressionIndex === -1 && combined.length !== 8) return undefined;
	if (compressionIndex !== -1 && combined.length >= 8) return undefined;

	const missing = 8 - combined.length;
	const hextets =
		compressionIndex === -1
			? combined
			: [...left, ...Array.from({ length: missing }, () => "0"), ...right];
	if (hextets.length !== 8) return undefined;

	let address = 0n;
	for (const hextet of hextets) address = (address << 16n) | BigInt(`0x${hextet}`);
	return address;
}

function rangeFromIpv4(network: string, prefixLength: number): AddressRange {
	const parsed = parseCanonicalIpv4(network);
	if (parsed === undefined) throw new Error("Invalid internal IPv4 range");
	return Object.freeze({ network: parsed, prefixLength });
}

function rangeFromIpv6(network: string, prefixLength: number): AddressRange {
	const parsed = parseIpv6(network);
	if (parsed === undefined) throw new Error("Invalid internal IPv6 range");
	return Object.freeze({ network: parsed, prefixLength });
}

const BLOCKED_IPV4 = IPV4_BLOCKED_RANGES.map(([network, prefixLength]) =>
	rangeFromIpv4(network, prefixLength),
);
const BLOCKED_IPV6 = IPV6_BLOCKED_RANGES.map(([network, prefixLength]) =>
	rangeFromIpv6(network, prefixLength),
);

function isInRange(address: bigint, range: AddressRange, bitLength: number): boolean {
	const trailingBits = BigInt(bitLength - range.prefixLength);
	return address >> trailingBits === range.network >> trailingBits;
}

function classifyIpv4(address: bigint): LiteralAddressClassification {
	return BLOCKED_IPV4.some((range) => isInRange(address, range, IPV4_BIT_LENGTH))
		? "non-public-or-special-literal"
		: "ordinary-public-literal";
}

function classifyIpv6(address: bigint): LiteralAddressClassification {
	// IPv4-mapped IPv6 addresses inherit the IPv4 classification.
	if (address >> 32n === 0xffffn) return classifyIpv4(address & 0xffff_ffffn);

	if (BLOCKED_IPV6.some((range) => isInRange(address, range, IPV6_BIT_LENGTH))) {
		return "non-public-or-special-literal";
	}

	// Only the globally allocated 2000::/3 space is accepted by default. Newly
	// allocated special ranges outside it therefore fail closed until reviewed.
	return address >> 125n === 1n ? "ordinary-public-literal" : "non-public-or-special-literal";
}

function containsUnsafeCodePoint(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const following = value.charCodeAt(index + 1);
			if (following < 0xdc00 || following > 0xdfff) return true;
			index += 1;
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
		// Literal ASCII space is permitted inside a URL because WHATWG encodes it.
		// Every other C0/C1 control remains forbidden.
		if (codeUnit < 0x20 || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
		if (
			codeUnit === 0x061c ||
			codeUnit === 0x200b ||
			codeUnit === 0x200c ||
			codeUnit === 0x200d ||
			codeUnit === 0x200e ||
			codeUnit === 0x200f ||
			(codeUnit >= 0x2028 && codeUnit <= 0x202e) ||
			(codeUnit >= 0x2066 && codeUnit <= 0x2069) ||
			codeUnit === 0xfeff
		) {
			return true;
		}
	}
	return false;
}

function classifyHostname(hostname: string): HostClassification {
	const ipv4 = parseCanonicalIpv4(hostname);
	if (ipv4 !== undefined) return classifyIpv4(ipv4);

	const ipv6 = parseIpv6(hostname);
	if (ipv6 !== undefined) return classifyIpv6(ipv6);

	const labels = hostname.split(".");
	if (
		labels.length === 1 ||
		labels.some((label) => label.length === 0 || label.length > 63) ||
		hostname.length > 253 ||
		hostname === "localhost" ||
		hostname.endsWith(".localhost") ||
		hostname === "local" ||
		hostname.endsWith(".local") ||
		hostname === "internal" ||
		hostname.endsWith(".internal") ||
		hostname === "home.arpa" ||
		hostname.endsWith(".home.arpa")
	) {
		return "non-public-or-special-literal";
	}

	return "hostname-requires-resolution";
}

function normalizedHostFromUrl(url: URL): string | undefined {
	let hostname = url.hostname.toLowerCase();
	if (hostname.startsWith("[") && hostname.endsWith("]")) {
		hostname = hostname.slice(1, -1);
	} else if (hostname.endsWith(".")) {
		hostname = hostname.slice(0, -1);
		if (hostname.endsWith(".")) return undefined;
	}
	return hostname.length === 0 ? undefined : hostname;
}

function exceedsTargetByteLimit(value: string): boolean {
	return (
		value.length > MAX_NETWORK_TARGET_BYTES ||
		new TextEncoder().encode(value).byteLength > MAX_NETWORK_TARGET_BYTES
	);
}

function parseTargetPolicy(value: unknown): TargetPolicyResult {
	if (typeof value !== "string" || value.length === 0) {
		return { ok: false, reason: "empty" };
	}
	if (value.length > MAX_NETWORK_TARGET_BYTES) return { ok: false, reason: "too-large" };
	// Reject leading and trailing whitespace rather than silently normalizing it.
	if (value !== value.trim()) return { ok: false, reason: "empty" };
	if (containsUnsafeCodePoint(value)) return { ok: false, reason: "unsafe-unicode" };
	if (exceedsTargetByteLimit(value)) return { ok: false, reason: "too-large" };
	// WHATWG special-URL backslash normalization is not safe for an exact target
	// interpreted later by a different transport.
	if (value.includes("\\")) return { ok: false, reason: "malformed" };
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
	if (scheme !== "http" && scheme !== "https") {
		return { ok: false, reason: scheme ? "unsupported-scheme" : "malformed" };
	}
	// Require an explicit authority spelling. WHATWG otherwise accepts and
	// rewrites forms such as `http:example.com` and `http:///example.com`.
	if (!/^https?:\/\/[^/?#]/i.test(value)) return { ok: false, reason: "malformed" };

	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { ok: false, reason: "malformed" };
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { ok: false, reason: "unsupported-scheme" };
	}
	if (url.hash.length > 0) return { ok: false, reason: "malformed" };

	const hostname = normalizedHostFromUrl(url);
	if (!hostname) return { ok: false, reason: "malformed" };
	const port = url.port.length > 0 ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		return { ok: false, reason: "malformed" };
	}

	return { ok: true, value: { url, hostClassification: classifyHostname(hostname) } };
}

const UNSAFE_FETCH_URL_MESSAGES: Readonly<Record<UnsafeFetchUrlReason, string>> = Object.freeze({
	empty: "Refusing to fetch an empty URL.",
	"too-large": "Refusing to fetch an oversized URL.",
	malformed: "Refusing to fetch a malformed URL.",
	"unsupported-scheme": "Refusing to fetch an unsupported URL scheme.",
	"unsafe-unicode": "Refusing to fetch a URL containing unsafe characters.",
	"non-public-or-special-host": "Refusing to fetch a non-public or special address.",
});

/** A stable, redacted target-policy error that never contains the rejected URL. */
export class UnsafeFetchUrlError extends Error {
	constructor(public readonly reason: UnsafeFetchUrlReason) {
		super(UNSAFE_FETCH_URL_MESSAGES[reason]);
		this.name = "UnsafeFetchUrlError";
	}
}

/**
 * Applies the synchronous target policy and returns the canonical encoded
 * HTTP(S) target. Credentials remain confined to this returned URL; failures
 * expose only a stable reason and redacted message.
 */
export function assertFetchableUrl(rawUrl: string): URL {
	const policy = parseTargetPolicy(rawUrl);
	if (!policy.ok) throw new UnsafeFetchUrlError(policy.reason);
	if (policy.value.hostClassification === "non-public-or-special-literal") {
		throw new UnsafeFetchUrlError("non-public-or-special-host");
	}

	const encodedTarget = encodeUrlForRequest(policy.value.url.href);
	if (exceedsTargetByteLimit(encodedTarget)) throw new UnsafeFetchUrlError("too-large");
	return new URL(encodedTarget);
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
