import { describe, expect, it } from "vitest";
import {
	isCredentialBearingUrl,
	isPrivateFeedPlaceholder,
	parsePrivateFeedPlaceholder,
	privateFeedPlaceholder,
	redactPrivateFeedAddresses,
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

describe("isCredentialBearingUrl for publishers that put the secret in the address", () => {
	it.each([
		["Supercast", "https://supercast.com/feeds/T0ken"],
		["Supercast", "https://blah.supercast.com/feeds/T0ken"],
		["Supercast", "https://blah.supercast.tech/feeds/T0ken/feed.xml"],
		["Supercast", "https://examplecast.supercast.com/feed/7f3a1c2e9b044d21.rss"],
		["Supercast", "https://examplecast.supercast.tech/feed/7f3a1c2e9b044d21.rss"],
		["Substack", "https://api.substack.com/feed/podcast/87281/private/0a1b2c3d-4e5f.rss"],
		["Substack", "https://api.substack.com/feed/podcast/87281/s/87957/private/0a1b2c3d.rss"],
		["Substack", "https://example.substack.com/feed/podcast/87281/private/0a1b2c3d.rss"],
		["Supporting Cast", "https://mynetwork.supportingcast.fm/content/er24343q4f.rss"],
		["Transistor", "https://subscribers.transistor.fm/979d5ed988d153"],
		["Pinecast", "https://pinecast.com/feed/my-show/sub/aaaa-bbbb-cccc-dddd-eeee"],
		["Captivate", "https://private.captivate.fm/4c1e7a/9b2f0d"],
		["RedCircle", "https://feeds.redcircle.com/6f1c2d3e-4b5a/pf/0d9e8f7a"],
		["RedCircle", "https://api.podcache.net/shows/6f1c2d3e-4b5a/pf/rct_0d9e8f7a"],
		["Castos", "https://myshow.castos.com/feed?uuid=3f2a9c1d-7b6e"],
		["host case", "https://Blah.SuperCast.COM/feeds/T0ken"],
		["terminal dot", "https://blah.supercast.com./feeds/T0ken"],
		["terminal dot", "https://subscribers.transistor.fm./979d5ed988d153"],
		["http and port", "http://blah.supercast.com:8443/feeds/T0ken"],
		["http and port", "http://subscribers.transistor.fm:80/979d5ed988d153"],
		["http and port", "http://myshow.castos.com:8080/feed?uuid=3f2a9c1d"],
	])("%s: %s is private", (_rule, url) => {
		expect(isCredentialBearingUrl(url)).toBe(true);
	});

	it.each([
		["Supercast", "public sibling host", "https://feeds.megaphone.fm/mega"],
		["Supercast", "same-host page", "https://mega.supercast.com/"],
		[
			"Supercast",
			"same-host page",
			"https://www.supercast.com/blog/what-is-a-private-rss-feed",
		],
		["Supercast", "empty token", "https://blah.supercast.com/feeds/"],
		["Supercast", "empty token", "https://blah.supercast.com/feed/.rss"],
		["Supercast", "path case", "https://blah.supercast.com/FEEDS/T0ken"],
		["Substack", "public feed", "https://api.substack.com/feed/podcast/87281.rss"],
		["Substack", "public feed", "https://api.substack.com/feed/podcast/87281/s/87957.rss"],
		["Substack", "other route", "https://api.substack.com/feed/podcast/87281/private/0a1b2c3d"],
		["Substack", "other route", "https://example.substack.com/private/0a1b2c3d.rss"],
		["Substack", "other host", "https://www.example.com/feed/podcast/87281/private/x.rss"],
		["Supporting Cast", "same-host path", "https://mynetwork.supportingcast.fm/"],
		[
			"Supporting Cast",
			"same-host path",
			"https://media.supportingcast.fm/content/11828/a1.png",
		],
		["Supporting Cast", "bare domain", "https://supportingcast.fm/content/er24343q4f.rss"],
		[
			"Supporting Cast",
			"unsourced domain",
			"https://mynetwork.supportingcast.co/content/x.rss",
		],
		[
			"Supporting Cast",
			"unsourced domain",
			"https://mynetwork.supportingcast.cc/content/x.rss",
		],
		["Transistor", "public sibling host", "https://feeds.transistor.fm/the-caffeine-show"],
		["Transistor", "same-host page", "https://subscribers.transistor.fm/"],
		["Pinecast", "public feed", "https://pinecast.com/feed/example"],
		["Pinecast", "empty token", "https://pinecast.com/feed/my-show/sub/"],
		["Captivate", "public sibling host", "https://feeds.captivate.fm/insider/"],
		["Captivate", "same-host page", "https://private.captivate.fm/"],
		["RedCircle", "public feed", "https://feeds.redcircle.com/6f1c2d3e-4b5a"],
		["RedCircle", "public feed", "https://api.podcache.net/shows/6f1c2d3e-4b5a/feed"],
		["RedCircle", "empty token", "https://feeds.redcircle.com/6f1c2d3e-4b5a/pf/"],
		["Castos", "public feed", "https://myshow.castos.com/feed"],
		["Castos", "public feed", "https://feeds.castos.com/abcd1234"],
		["Castos", "empty value", "https://myshow.castos.com/feed?uuid="],
		["Castos", "bare domain", "https://castos.com/feed?uuid=3f2a9c1d"],
		["Castos", "other host", "https://example.com/feed?uuid=3f2a9c1d"],
		["NPR", "out of scope", "https://feeds.npr.org/510289/podcast.xml?uid=3f2a9c1d"],
		["Acast Access", "out of scope", "https://access.acast.com/my-show/3f2a9c1d"],
		["lookalike", "suffix", "https://supercast.com.example.net/feeds/T0ken"],
		["lookalike", "label", "https://evilsupercast.com/feeds/T0ken"],
		["lookalike", "label", "https://xsubscribers.transistor.fm/979d5ed988d153"],
		["lookalike", "subdomain", "https://x.subscribers.transistor.fm/979d5ed988d153"],
		["lookalike", "suffix", "https://subscribers.transistor.fm.example.net/979d5ed988d153"],
		["lookalike", "label", "https://notcastos.com/feed?uuid=3f2a9c1d"],
		["lookalike", "query", "https://example.net/?u=https://blah.supercast.com/feeds/T0ken"],
		["lookalike", "query", "https://evil.example/?q=substack.com/feed/podcast/1/private/x.rss"],
	])("%s: %s %s is not private", (_rule, _kind, url) => {
		expect(isCredentialBearingUrl(url)).toBe(false);
	});
});

describe("redactPrivateFeedAddresses", () => {
	it("finds the address of a host the previous pass did not see", () => {
		const patreon = "https://www.patreon.com/rss/show?auth=FIRST_SENTINEL";
		const supercast = "https://show.supercast.com/feeds/SECOND_SENTINEL";
		const snapshot = (feedUrl: string, podcastName: string) => ({
			podcastName,
			feedUrl,
			description: `Your feed: ${feedUrl}.`,
		});

		expect(redactPrivateFeedAddresses(snapshot(patreon, "First"))).toEqual(
			snapshot("podnotes-private-feed:First", "First"),
		);
		expect(redactPrivateFeedAddresses(snapshot(supercast, "Second"))).toEqual(
			snapshot("podnotes-private-feed:Second", "Second"),
		);
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
