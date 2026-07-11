import { describe, expect, it } from "vitest";
import {
	isCredentialBearingUrl,
	isPrivateFeedPlaceholder,
	parsePrivateFeedPlaceholder,
	privateFeedPlaceholder,
} from "./privateFeedUrl";

describe("isCredentialBearingUrl", () => {
	it("detects userinfo credentials", () => {
		expect(isCredentialBearingUrl("https://user:pass@feeds.example.com/rss")).toBe(true);
		expect(isCredentialBearingUrl("https://user@feeds.example.com/rss")).toBe(true);
	});

	it("detects auth-bearing query parameters regardless of case", () => {
		expect(isCredentialBearingUrl("https://www.patreon.com/rss/show?auth=se-cret")).toBe(true);
		expect(isCredentialBearingUrl("https://example.com/feed?TOKEN=x")).toBe(true);
		expect(isCredentialBearingUrl("https://example.com/feed?a=1&api_key=x")).toBe(true);
		expect(isCredentialBearingUrl("https://example.com/feed?access-token=x")).toBe(true);
	});

	it("leaves ordinary public feeds alone", () => {
		expect(isCredentialBearingUrl("https://feed.syntax.fm/rss")).toBe(false);
		expect(isCredentialBearingUrl("https://example.com/feed?page=2&format=rss")).toBe(false);
		// Substring matches must not trigger: "keyword" is not "key".
		expect(isCredentialBearingUrl("https://example.com/feed?keyword=rust")).toBe(false);
		expect(isCredentialBearingUrl("https://example.com/feed?authors=jane")).toBe(false);
	});

	it("rejects non-http and malformed inputs", () => {
		expect(isCredentialBearingUrl("podnotes-private-feed:My%20Show")).toBe(false);
		expect(isCredentialBearingUrl("not a url")).toBe(false);
		expect(isCredentialBearingUrl("")).toBe(false);
	});
});

describe("private feed placeholder", () => {
	it("round-trips a feed name, including URL-hostile characters", () => {
		for (const name of ["My Show", "Show/With?Chars#&+", "ÆØÅ 播客"]) {
			const placeholder = privateFeedPlaceholder(name);
			expect(isPrivateFeedPlaceholder(placeholder)).toBe(true);
			expect(parsePrivateFeedPlaceholder(placeholder)).toBe(name);
			// The placeholder must never be a fetchable http(s) URL.
			expect(placeholder.startsWith("http")).toBe(false);
		}
	});

	it("returns null for non-placeholder values", () => {
		expect(parsePrivateFeedPlaceholder("https://feeds.example.com/rss")).toBeNull();
		expect(parsePrivateFeedPlaceholder("")).toBeNull();
	});

	it("returns null for a malformed percent-encoding instead of throwing", () => {
		expect(parsePrivateFeedPlaceholder("podnotes-private-feed:%E0%A4%A")).toBeNull();
	});
});
