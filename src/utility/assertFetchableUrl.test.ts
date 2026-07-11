import { describe, expect, it } from "vitest";
import {
	MAX_NETWORK_TARGET_BYTES,
	UnsafeFetchUrlError,
	assertFetchableUrl,
	isFetchableUrl,
	type UnsafeFetchUrlReason,
} from "./assertFetchableUrl";

function expectRejection(target: string, reason: UnsafeFetchUrlReason): void {
	expect(() => assertFetchableUrl(target)).toThrowError(
		expect.objectContaining({ name: "UnsafeFetchUrlError", reason }),
	);
}

describe("assertFetchableUrl", () => {
	it("accepts ordinary public HTTP(S) feed and enclosure URLs", () => {
		expect(() =>
			assertFetchableUrl("https://pod.example.com/audio.mp3?token=abc"),
		).not.toThrow();
		expect(() => assertFetchableUrl("http://cdn.example.org/ep/1.mp3")).not.toThrow();
		expect(() => assertFetchableUrl("https://8.8.8.8/feed.xml")).not.toThrow();
	});

	it("returns the complete parsed target, including credentials", () => {
		const url = assertFetchableUrl(
			"HTTPS://User:Pass@ExAmPle.COM.:443/a%2Fb?sig=A%2BB&token=secret",
		);

		expect(url.href).toBe("https://User:Pass@example.com./a%2Fb?sig=A%2BB&token=secret");
		expect(url.username).toBe("User");
		expect(url.password).toBe("Pass");
	});

	it("canonicalizes and encodes accepted internal ASCII spaces and parentheses", () => {
		const url = assertFetchableUrl(
			"https://example.com/podcast/Episode (Part 1).mp3?token=(abc)",
		);

		expect(url.href).toBe(
			"https://example.com/podcast/Episode%20%28Part%201%29.mp3?token=%28abc%29",
		);
	});

	it.each([
		["file://user:secret@example.com/private?token=secret", "unsupported-scheme"],
		["https://user:secret@localhost/private?token=secret", "non-public-or-special-host"],
		["https://user:secret@example.com/#token=secret", "malformed"],
	] as const)("returns only a stable redacted error for %s", (target, reason) => {
		let thrown: unknown;
		try {
			assertFetchableUrl(target);
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(UnsafeFetchUrlError);
		expect(thrown).toMatchObject({ name: "UnsafeFetchUrlError", reason });
		const error = thrown as UnsafeFetchUrlError;
		expect(error.message).not.toContain(target);
		expect(error.message).not.toContain("secret");
		expect(JSON.stringify({ message: error.message, reason: error.reason })).not.toContain(
			"secret",
		);
	});

	it.each(["", "   ", " https://example.com/feed", "https://example.com/feed "])(
		"rejects empty or leading/trailing-whitespace input without normalization: %s",
		(target) => {
			expectRejection(target, "empty");
		},
	);

	it.each([
		[0x00, "NULL"],
		[0x09, "TAB"],
		[0x0a, "LF"],
		[0x1f, "C0 control"],
		[0x7f, "DELETE"],
		[0x85, "C1 control"],
		[0x061c, "Arabic letter mark"],
		[0x200b, "zero-width space"],
		[0x200c, "zero-width non-joiner"],
		[0x200d, "zero-width joiner"],
		[0x200e, "left-to-right mark"],
		[0x200f, "right-to-left mark"],
		[0x2028, "line separator"],
		[0x2029, "paragraph separator"],
		[0x202a, "left-to-right embedding"],
		[0x202b, "right-to-left embedding"],
		[0x202c, "pop directional formatting"],
		[0x202d, "left-to-right override"],
		[0x202e, "right-to-left override"],
		[0x2066, "left-to-right isolate"],
		[0x2067, "right-to-left isolate"],
		[0x2068, "first strong isolate"],
		[0x2069, "pop directional isolate"],
		[0xfeff, "byte-order mark"],
	] as const)("rejects internal code point %s", (codePoint, _name) => {
		const target = `https://example.com/a${String.fromCodePoint(codePoint)}b`;
		expectRejection(target, "unsafe-unicode");
	});

	it("rejects unpaired UTF-16 surrogates", () => {
		expectRejection(`https://example.com/a${String.fromCharCode(0xd800)}b`, "unsafe-unicode");
		expectRejection(`https://example.com/a${String.fromCharCode(0xdc00)}b`, "unsafe-unicode");
	});

	it.each([
		"file:///Users/victim/.ssh/id_rsa",
		"data:text/plain,hello",
		"blob:https://example.com/uuid",
		"ftp://example.com/file",
		"javascript:alert(1)",
	])("rejects a non-HTTP(S) scheme: %s", (url) => {
		expectRejection(url, "unsupported-scheme");
	});

	it.each([
		"not a target",
		"//example.com/no-scheme",
		"https://example.com/#fragment",
		"https:\\example.com\\feed",
		"http:example.com/feed",
		"http:/example.com/feed",
		"http:///example.com/feed",
		"https:////example.com/feed",
		"https://",
	])("rejects malformed URL or authority syntax: %s", (url) => {
		expectRejection(url, "malformed");
	});

	it.each([
		"http://localhost/feed.xml",
		"http://LOCALHOST:8080/x",
		"http://api.localhost/x",
		"http://localhost./x",
		"http://LOCALHOST./x",
		"http://sub.localhost./x",
		"http://printer.local/x",
		"http://service.internal/x",
		"http://router.home.arpa/x",
		"http://single-label/x",
	])("blocks a locally scoped hostname: %s", (url) => {
		expectRejection(url, "non-public-or-special-host");
	});

	it.each([
		"http://0.0.0.0/x",
		"http://10.0.0.1/x",
		"http://100.64.0.1/x",
		"http://127.0.0.1/x",
		"http://169.254.169.254/latest/meta-data/",
		"http://172.31.255.255/x",
		"http://192.0.0.9/x",
		"http://192.0.2.1/x",
		"http://192.31.196.1/x",
		"http://192.52.193.1/x",
		"http://192.88.99.1/x",
		"http://192.168.1.1/x",
		"http://192.175.48.1/x",
		"http://198.18.0.1/x",
		"http://198.51.100.1/x",
		"http://203.0.113.1/x",
		"http://224.0.0.1/x",
		"http://255.255.255.255/x",
	])("blocks a non-public or special IPv4 host: %s", (url) => {
		expectRejection(url, "non-public-or-special-host");
	});

	it.each([
		"http://2130706433/x",
		"http://0x7f000001/x",
		"http://0177.0.0.1/x",
		"http://192.168.1/x",
		"http://0/x",
	])("blocks an obfuscated non-public IPv4 host: %s", (url) => {
		expectRejection(url, "non-public-or-special-host");
	});

	it.each([
		"http://[::]/x",
		"http://[::1]/x",
		"http://[64:ff9b::c000:201]/x",
		"http://[64:ff9b:1::1]/x",
		"http://[100::1]/x",
		"http://[100:0:0:1::1]/x",
		"http://[2001::1]/x",
		"http://[2001:db8::1]/x",
		"http://[2002::1]/x",
		"http://[2620:4f:8000::1]/x",
		"http://[3fff::1]/x",
		"http://[5f00::1]/x",
		"http://[fc00::1]/x",
		"http://[fd12:3456:789a::1]/x",
		"http://[fe80::1]/x",
		"http://[fec0::1]/x",
		"http://[ff02::1]/x",
		"http://[4000::1]/x",
		"http://[::ffff:127.0.0.1]/x",
		"http://[::ffff:169.254.169.254]/x",
		"http://[::ffff:7f00:1]/x",
	])("blocks a special or non-global IPv6 host: %s", (url) => {
		expectRejection(url, "non-public-or-special-host");
	});

	it.each([
		"https://1.1.1.1/x",
		"https://8.8.8.8/x",
		"https://93.184.216.34/x",
		"https://223.255.255.254/x",
		"https://[2001:4860:4860::8888]/x",
		"https://[2606:4700:4700::1111]/x",
		"https://[::ffff:8.8.8.8]/x",
		"https://pod.example.com./feed.xml",
	])("allows an ordinary public address or hostname: %s", (url) => {
		expect(() => assertFetchableUrl(url)).not.toThrow();
	});

	it.each(["https://@example.com/feed", "https://:@example.com/feed"])(
		"accepts even empty credential syntax for private-feed compatibility: %s",
		(target) => {
			expect(() => assertFetchableUrl(target)).not.toThrow();
		},
	);

	it("bounds both raw and canonical encoded targets by UTF-8 bytes", () => {
		const prefix = "https://example.com/";
		const oversized = `${prefix}${"x".repeat(MAX_NETWORK_TARGET_BYTES - prefix.length + 1)}`;
		expectRejection(oversized, "too-large");

		const multibyte = `${prefix}${"é".repeat(MAX_NETWORK_TARGET_BYTES / 2)}`;
		expect(multibyte.length).toBeLessThan(MAX_NETWORK_TARGET_BYTES);
		expectRejection(multibyte, "too-large");

		const expandsPastLimit = `${prefix}${" ".repeat(
			MAX_NETWORK_TARGET_BYTES - prefix.length - 1,
		)}x`;
		expect(new TextEncoder().encode(expandsPastLimit).byteLength).toBe(
			MAX_NETWORK_TARGET_BYTES,
		);
		expectRejection(expandsPastLimit, "too-large");
	});

	it("exposes a non-throwing predicate", () => {
		expect(isFetchableUrl("https://example.com/Episode (Part 1).mp3")).toBe(true);
		expect(isFetchableUrl("http://169.254.169.254/")).toBe(false);
		expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
	});
});
