import { describe, expect, it } from "vitest";
import {
	MAX_NETWORK_TARGET_BYTES,
	MAX_RESOLVED_ADDRESS_TEXT_LENGTH,
	classifyResolvedAddress,
	isResolvedAddressLiteral,
	parseTargetPolicyView,
	resolvedAddressesEqual,
} from "./LiteralTargetClassifier";

describe("literal network target classification", () => {
	it.each([
		"0.0.0.0",
		"10.0.0.1",
		"100.64.0.1",
		"127.0.0.1",
		"169.254.169.254",
		"172.31.255.255",
		"192.0.0.9",
		"192.0.2.1",
		"192.31.196.1",
		"192.52.193.1",
		"192.88.99.1",
		"192.168.1.1",
		"192.175.48.1",
		"198.18.0.1",
		"198.51.100.1",
		"203.0.113.1",
		"224.0.0.1",
		"255.255.255.255",
	])("fails closed for a special IPv4 address: %s", (address) => {
		expect(classifyResolvedAddress(address)).toBe("non-public-or-special-literal");
	});

	it.each(["1.1.1.1", "8.8.8.8", "93.184.216.34", "223.255.255.254"])(
		"accepts an ordinary public IPv4 address: %s",
		(address) => {
			expect(classifyResolvedAddress(address)).toBe("ordinary-public-literal");
		},
	);

	it("compares socket addresses canonically without accepting non-addresses", () => {
		expect(resolvedAddressesEqual("2001:4860::1", "2001:4860:0:0:0:0:0:1")).toBe(true);
		expect(resolvedAddressesEqual("8.8.8.8", "::ffff:8.8.8.8")).toBe(true);
		expect(resolvedAddressesEqual("8.8.8.8", "8.8.4.4")).toBe(false);
		expect(resolvedAddressesEqual("private.example", "private.example")).toBe(false);
	});

	it.each([
		"::",
		"::1",
		"64:ff9b::c000:201",
		"64:ff9b:1::1",
		"100::1",
		"100:0:0:1::1",
		"2001::1",
		"2001:db8::1",
		"2002::1",
		"2620:4f:8000::1",
		"3fff::1",
		"5f00::1",
		"fc00::1",
		"fe80::1",
		"fec0::1",
		"ff02::1",
		"4000::1",
	])("fails closed for a special or non-global IPv6 address: %s", (address) => {
		expect(classifyResolvedAddress(address)).toBe("non-public-or-special-literal");
	});

	it.each(["2001:4860:4860::8888", "2606:4700:4700::1111"])(
		"accepts an ordinary public IPv6 address: %s",
		(address) => {
			expect(classifyResolvedAddress(address)).toBe("ordinary-public-literal");
		},
	);

	it("classifies IPv4-mapped IPv6 addresses by their embedded address", () => {
		expect(classifyResolvedAddress("::ffff:127.0.0.1")).toBe("non-public-or-special-literal");
		expect(classifyResolvedAddress("::ffff:8.8.8.8")).toBe("ordinary-public-literal");
	});

	it.each([
		"",
		" 8.8.8.8",
		"999.1.1.1",
		"8.8.8",
		"example.com",
		"fe80::1%en0",
		"2001:::1",
		"[2001:db8::1",
		"[2001:4860::1]",
		"32.1.72.96::",
		"2001:4860:32.1.72.96::",
		"8".repeat(MAX_RESOLVED_ADDRESS_TEXT_LENGTH + 1),
	])("treats a non-address resolver result as non-public: %s", (address) => {
		expect(classifyResolvedAddress(address)).toBe("non-public-or-special-literal");
		expect(isResolvedAddressLiteral(address)).toBe(false);
	});

	it.each(["8.8.8.8", "127.0.0.1", "2001:4860::1", "::1", "::ffff:8.8.8.8"])(
		"recognizes a strict resolver address spelling: %s",
		(address) => {
			expect(isResolvedAddressLiteral(address)).toBe(true);
		},
	);

	it.each([
		["https://127.0.0.1/feed", "non-public-or-special-literal"],
		["https://2130706433/feed", "non-public-or-special-literal"],
		["https://0x7f000001/feed", "non-public-or-special-literal"],
		["https://0177.0.0.1/feed", "non-public-or-special-literal"],
		["https://192.168.1/feed", "non-public-or-special-literal"],
		["https://8.8.8.8/feed", "ordinary-public-literal"],
		["https://[::1]/feed", "non-public-or-special-literal"],
		["https://[2606:4700:4700::1111]/feed", "ordinary-public-literal"],
		["https://feeds.example.com/feed", "hostname-requires-resolution"],
	] as const)("classifies a parsed target host: %s", (target, classification) => {
		const result = parseTargetPolicyView(target);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.hostClassification).toBe(classification);
	});

	it.each([
		"http://localhost/feed",
		"https://api.localhost/feed",
		"https://printer.local/feed",
		"https://service.internal/feed",
		"https://router.home.arpa/feed",
		"https://single-label/feed",
	])("fails closed for a locally scoped hostname: %s", (target) => {
		const result = parseTargetPolicyView(target);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.hostClassification).toBe("non-public-or-special-literal");
		}
	});

	it("produces a canonical policy view without returning a transmission target", () => {
		const result = parseTargetPolicyView("HTTPS://User:Pass@ExAmPle.COM.:443/a%2Fb?sig=A%2BB");
		expect(result).toEqual({
			ok: true,
			value: {
				protocol: "https:",
				normalizedHostname: "example.com",
				normalizedOrigin: "https://example.com",
				port: 443,
				hasCredentials: true,
				hostClassification: "hostname-requires-resolution",
			},
		});
		if (result.ok) {
			expect(Object.isFrozen(result.value)).toBe(true);
			expect(result.value).not.toHaveProperty("target");
			expect(JSON.stringify(result.value)).not.toContain("sig=A");
		}
	});

	it("canonicalizes IPv6 origins and preserves non-default ports in policy only", () => {
		const result = parseTargetPolicyView("http://[2001:4860:4860::8888]:8080/feed");
		expect(result).toEqual({
			ok: true,
			value: {
				protocol: "http:",
				normalizedHostname: "2001:4860:4860::8888",
				normalizedOrigin: "http://[2001:4860:4860::8888]:8080",
				port: 8080,
				hasCredentials: false,
				hostClassification: "ordinary-public-literal",
			},
		});
	});

	it.each([
		[undefined, "empty"],
		["", "empty"],
		[" https://example.com", "empty"],
		["https://example.com ", "empty"],
		["https://exa\n mple.com", "unsafe-unicode"],
		[`https://exa${String.fromCharCode(0xd800)}mple.com`, "unsafe-unicode"],
		["mailto:owner@example.com", "unsupported-scheme"],
		["file:///etc/passwd", "unsupported-scheme"],
		["ftp://example.com/feed", "unsupported-scheme"],
		["https://example.com/#fragment", "malformed"],
		["https:\\example.com\\feed", "malformed"],
		["http:example.com/feed", "malformed"],
		["http:/example.com/feed", "malformed"],
		["http:///example.com/feed", "malformed"],
		["https:////example.com/feed", "malformed"],
		["not a target", "unsafe-unicode"],
		["https://", "malformed"],
	] as const)("rejects an invalid target without echoing it: %s", (target, reason) => {
		const result = parseTargetPolicyView(target);
		expect(result).toEqual({ ok: false, reason });
		if (typeof target === "string" && target.length > 0) {
			expect(JSON.stringify(result)).not.toContain(target);
		}
	});

	it.each(["https://@example.com/feed", "https://:@example.com/feed"])(
		"detects even empty userinfo syntax: %s",
		(target) => {
			const result = parseTargetPolicyView(target);
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.value.hasCredentials).toBe(true);
		},
	);

	it("bounds targets by UTF-8 bytes rather than UTF-16 code units", () => {
		const prefix = "https://example.com/";
		const oversized = `${prefix}${"x".repeat(MAX_NETWORK_TARGET_BYTES - prefix.length + 1)}`;
		expect(parseTargetPolicyView(oversized)).toEqual({ ok: false, reason: "too-large" });

		const multibyte = `${prefix}${"é".repeat(MAX_NETWORK_TARGET_BYTES / 2)}`;
		expect(multibyte.length).toBeLessThan(MAX_NETWORK_TARGET_BYTES);
		expect(parseTargetPolicyView(multibyte)).toEqual({ ok: false, reason: "too-large" });
	});
});
