import { describe, expect, it } from "vitest";
import { assertFetchableUrl, isFetchableUrl, UnsafeFetchUrlError } from "./assertFetchableUrl";

describe("assertFetchableUrl", () => {
	it("accepts ordinary public http(s) feed/enclosure URLs", () => {
		expect(() =>
			assertFetchableUrl("https://pod.example.com/audio.mp3?token=abc"),
		).not.toThrow();
		expect(() => assertFetchableUrl("http://cdn.example.org/ep/1.mp3")).not.toThrow();
		// A public IP is fine.
		expect(() => assertFetchableUrl("https://8.8.8.8/feed.xml")).not.toThrow();
	});

	it("returns the parsed URL", () => {
		const url = assertFetchableUrl("https://example.com/a.mp3");
		expect(url.hostname).toBe("example.com");
	});

	it.each([
		"file:///Users/victim/.ssh/id_rsa",
		"data:text/plain,hello",
		"blob:https://example.com/uuid",
		"ftp://example.com/file",
		"javascript:alert(1)",
	])("rejects non-http(s) scheme %s", (url) => {
		expect(() => assertFetchableUrl(url)).toThrow(UnsafeFetchUrlError);
	});

	it.each(["", "   ", "not a url", "//example.com/no-scheme"])(
		"rejects empty/malformed url %s",
		(url) => {
			expect(() => assertFetchableUrl(url)).toThrow(UnsafeFetchUrlError);
		},
	);

	it.each([
		"http://localhost/feed.xml",
		"http://LOCALHOST:8080/x",
		"http://api.localhost/x",
		"http://localhost./x", // absolute-FQDN form still resolves to loopback
		"http://LOCALHOST./x",
		"http://sub.localhost./x",
		"http://127.0.0.1/x",
		"http://127.1.2.3/x",
		"http://10.0.0.5/x",
		"http://172.16.0.1/x",
		"http://172.31.255.255/x",
		"http://192.168.1.5/x",
		"http://169.254.169.254/latest/meta-data/", // cloud metadata
		"http://0.0.0.0/x",
	])("blocks loopback/private/link-local host %s", (url) => {
		expect(() => assertFetchableUrl(url)).toThrow(UnsafeFetchUrlError);
	});

	it.each([
		"http://2130706433/x", // 127.0.0.1 as integer
		"http://0x7f000001/x", // 127.0.0.1 as hex
		"http://0177.0.0.1/x", // 127.0.0.1 with octal leading octet
		"http://0/x", // 0.0.0.0
	])("blocks obfuscated IPv4 loopback %s", (url) => {
		expect(() => assertFetchableUrl(url)).toThrow(UnsafeFetchUrlError);
	});

	it.each([
		"http://[::1]/x", // loopback
		"http://[::]/x", // unspecified
		"http://[fe80::1]/x", // link-local
		"http://[fc00::1]/x", // unique-local
		"http://[fd12:3456:789a::1]/x", // unique-local
		"http://[::ffff:127.0.0.1]/x", // IPv4-mapped loopback
		"http://[::ffff:169.254.169.254]/x", // IPv4-mapped metadata
		"http://[::ffff:7f00:1]/x", // IPv4-mapped loopback in hex form
	])("blocks loopback/private IPv6 host %s", (url) => {
		expect(() => assertFetchableUrl(url)).toThrow(UnsafeFetchUrlError);
	});

	it.each([
		"https://[2606:4700:4700::1111]/x", // public IPv6 (Cloudflare DNS)
		"https://203.0.113.10/x", // public IPv4
		"https://pod.example.com./feed.xml", // legit absolute FQDN is not blocked
	])("allows public IPv6/IPv4/FQDN host %s", (url) => {
		expect(() => assertFetchableUrl(url)).not.toThrow();
	});

	it("exposes a non-throwing predicate", () => {
		expect(isFetchableUrl("https://example.com/a.mp3")).toBe(true);
		expect(isFetchableUrl("http://169.254.169.254/")).toBe(false);
		expect(isFetchableUrl("file:///etc/passwd")).toBe(false);
	});
});
