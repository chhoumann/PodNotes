export const MAX_NETWORK_TARGET_BYTES = 16 * 1024;
export const MAX_RESOLVED_ADDRESS_TEXT_LENGTH = 64;

export type HostClassification =
	| "ordinary-public-literal"
	| "non-public-or-special-literal"
	| "hostname-requires-resolution";

export type LiteralAddressClassification = Exclude<
	HostClassification,
	"hostname-requires-resolution"
>;

export type NetworkProtocol = "http:" | "https:";

export interface TargetPolicyView {
	readonly protocol: NetworkProtocol;
	/** Canonical policy-only hostname. IPv6 brackets and a terminal DNS dot are removed. */
	readonly normalizedHostname: string;
	/** Canonical policy-only origin. Never use this value as the transmitted target. */
	readonly normalizedOrigin: string;
	readonly port: number;
	readonly hasCredentials: boolean;
	readonly hostClassification: HostClassification;
}

export type TargetPolicyFailureReason =
	| "empty"
	| "too-large"
	| "malformed"
	| "unsupported-scheme"
	| "unsafe-unicode";

export type TargetPolicyResult =
	| { readonly ok: true; readonly value: TargetPolicyView }
	| { readonly ok: false; readonly reason: TargetPolicyFailureReason };

interface AddressRange {
	readonly network: bigint;
	readonly prefixLength: number;
}

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

export function classifyResolvedAddress(address: unknown): LiteralAddressClassification {
	if (
		typeof address !== "string" ||
		address.length === 0 ||
		address.length > MAX_RESOLVED_ADDRESS_TEXT_LENGTH ||
		address !== address.trim()
	) {
		return "non-public-or-special-literal";
	}

	const ipv4 = parseCanonicalIpv4(address);
	if (ipv4 !== undefined) return classifyIpv4(ipv4);

	const ipv6 = parseIpv6(address);
	return ipv6 === undefined ? "non-public-or-special-literal" : classifyIpv6(ipv6);
}

/** True only for the strict address spellings accepted from a resolver adapter. */
export function isResolvedAddressLiteral(address: unknown): address is string {
	if (
		typeof address !== "string" ||
		address.length === 0 ||
		address.length > MAX_RESOLVED_ADDRESS_TEXT_LENGTH ||
		address !== address.trim()
	) {
		return false;
	}
	return parseCanonicalIpv4(address) !== undefined || parseIpv6(address) !== undefined;
}

function canonicalResolvedAddress(
	address: unknown,
): { readonly family: 4 | 6; readonly value: bigint } | undefined {
	if (
		typeof address !== "string" ||
		address.length === 0 ||
		address.length > MAX_RESOLVED_ADDRESS_TEXT_LENGTH ||
		address !== address.trim()
	) {
		return undefined;
	}
	const ipv4 = parseCanonicalIpv4(address);
	if (ipv4 !== undefined) return { family: 4, value: ipv4 };
	const ipv6 = parseIpv6(address);
	if (ipv6 === undefined) return undefined;
	if (ipv6 >> 32n === 0xffffn) return { family: 4, value: ipv6 & 0xffff_ffffn };
	return { family: 6, value: ipv6 };
}

/** Compares strict resolver spellings, including IPv4-mapped socket addresses. */
export function resolvedAddressesEqual(left: unknown, right: unknown): boolean {
	const leftAddress = canonicalResolvedAddress(left);
	const rightAddress = canonicalResolvedAddress(right);
	return Boolean(
		leftAddress &&
		rightAddress &&
		leftAddress.family === rightAddress.family &&
		leftAddress.value === rightAddress.value,
	);
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
		if (codeUnit <= 0x20 || (codeUnit >= 0x7f && codeUnit <= 0x9f)) return true;
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

function normalizedOrigin(protocol: NetworkProtocol, hostname: string, port: number): string {
	const host = hostname.includes(":") ? `[${hostname}]` : hostname;
	const defaultPort = protocol === "https:" ? 443 : 80;
	return `${protocol}//${host}${port === defaultPort ? "" : `:${port}`}`;
}

export function parseTargetPolicyView(value: unknown): TargetPolicyResult {
	if (typeof value !== "string" || value.length === 0) {
		return { ok: false, reason: "empty" };
	}
	// Every UTF-8 encoding is at least as large as its UTF-16 code-unit count.
	// Reject obvious oversize input before trim, scanning, or allocation.
	if (value.length > MAX_NETWORK_TARGET_BYTES) return { ok: false, reason: "too-large" };
	if (value !== value.trim()) return { ok: false, reason: "empty" };
	if (containsUnsafeCodePoint(value)) return { ok: false, reason: "unsafe-unicode" };
	if (new TextEncoder().encode(value).byteLength > MAX_NETWORK_TARGET_BYTES) {
		return { ok: false, reason: "too-large" };
	}
	// WHATWG special-URL backslash normalization is not safe for a byte-exact
	// capability target interpreted later by a different transport.
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
	const protocol = url.protocol;
	const authorityStart = value.indexOf("//") + 2;
	const authorityEndCandidate = value.slice(authorityStart).search(/[/?#]/);
	const authorityEnd =
		authorityEndCandidate === -1 ? value.length : authorityStart + authorityEndCandidate;
	const rawAuthority = value.slice(authorityStart, authorityEnd);
	const port = url.port.length > 0 ? Number(url.port) : protocol === "https:" ? 443 : 80;
	if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
		return { ok: false, reason: "malformed" };
	}

	const classification = classifyHostname(hostname);
	const result: TargetPolicyView = Object.freeze({
		protocol,
		normalizedHostname: hostname,
		normalizedOrigin: normalizedOrigin(protocol, hostname, port),
		port,
		hasCredentials:
			rawAuthority.includes("@") || url.username.length > 0 || url.password.length > 0,
		hostClassification: classification,
	});
	return { ok: true, value: result };
}
