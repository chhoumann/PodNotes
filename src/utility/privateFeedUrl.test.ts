import { describe, expect, it, vi } from "vitest";
import checkStringIsUrl from "./checkStringIsUrl";
import {
	isCredentialBearingUrl,
	isPrivateFeedPlaceholder,
	parsePrivateFeedPlaceholder,
	privateFeedPlaceholder,
	redactPrivateFeedAddresses,
} from "./privateFeedUrl";

vi.mock("./checkStringIsUrl", async (importOriginal) => {
	const actual = await importOriginal<typeof import("./checkStringIsUrl")>();
	return { default: vi.fn(actual.default) };
});

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
	it.each([
		["feed scheme", "feed://private.example.com/rss?auth=FOLLOWUP_SENTINEL"],
		["podcast scheme", "podcast://private.example.com/rss?auth=FOLLOWUP_SENTINEL"],
		["feed-wrapped URL", "feed:https://private.example.com/rss?auth=FOLLOWUP_SENTINEL"],
		["HTTP", "http://private.example.com/rss?auth=FOLLOWUP_SENTINEL"],
		["scheme-less", "private.example.com/rss?auth=FOLLOWUP_SENTINEL"],
		["entity escaped", "https&#58;&#x2F;&#x2F;private.example.com/rss?auth=FOLLOWUP_SENTINEL"],
		["named entities", "https&colon;&sol;&sol;private.example.com/rss?auth=FOLLOWUP_SENTINEL"],
		["entity in hostname", "https://private&#46;example.com/rss?auth=FOLLOWUP_SENTINEL"],
		[
			"encoded query",
			"https://redirect.example/?url=https%3A%2F%2Fprivate.example.com%2Frss%3Fauth%3DFOLLOWUP_SENTINEL",
		],
	])("redacts the %s alias while preserving public text byte for byte", (_, alias) => {
		const known = new Map([
			[
				"https://private.example.com/rss?auth=FOLLOWUP_SENTINEL",
				"podnotes-private-feed:Paid",
			],
		]);
		const publicText = alias
			.replace("rss?auth=FOLLOWUP_SENTINEL", "public?show=1")
			.replace("rss%3Fauth%3DFOLLOWUP_SENTINEL", "public%3Fshow%3D1");
		const media = "https://private.example.com/audio.mp3?token=MEDIA_SIGNATURE";
		const document = { quoted: `Your feed: ${alias}.`, publicText, media };
		const safe = redactPrivateFeedAddresses(document, known);
		expect(safe.publicText).toBe(publicText);
		expect(safe.media).toBe(media);
		expect(safe.quoted).not.toContain("FOLLOWUP_SENTINEL");
		expect(safe.quoted).toContain("podnotes-private-feed");
		expect(safe.quoted.endsWith(".")).toBe(true);
	});

	it("redacts entity-encoded secret characters without decoding surrounding public markup", () => {
		const address = "https://private.example.com/rss?auth=FOLLOWUP_SENTINEL";
		const publicText =
			"&lt;b&gt;Public&lt;/b&gt; &amp; https://private.example.com/audio.mp3?token=MEDIA_SIGNATURE";
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		const text = `${publicText} ${address.replace("_", "&#95;")}.`;
		expect(redactPrivateFeedAddresses(text, known)).toBe(
			`${publicText} podnotes-private-feed:Paid.`,
		);
	});

	it("preserves sentence punctuation after a host-only private address", () => {
		const known = new Map([["https://private.example.com", "podnotes-private-feed:Paid"]]);
		expect(redactPrivateFeedAddresses("Visit https://public.example.com.", known)).toBe(
			"Visit https://public.example.com.",
		);
		expect(redactPrivateFeedAddresses("Visit https://private.example.com.", known)).toBe(
			"Visit podnotes-private-feed:Paid.",
		);
	});

	it("preserves the outer query bytes when its encoded private feed value is replaced", () => {
		const address = "https://private.example.com/rss?auth=NESTED_SENTINEL";
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		const outer = `https://redirect.example/?url=${encodeURIComponent(address)}&keep=a%2fb+z`;
		expect(redactPrivateFeedAddresses(outer, known)).toBe(
			"https://redirect.example/?url=podnotes-private-feed%3APaid&keep=a%2fb+z",
		);
	});

	it("keeps public path escapes and host-name suffixes distinct from a private address", () => {
		const address = "https://private.example.com/rss/private?auth=PATH_SENTINEL";
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		const publicUrls = [
			"https://private.example.com/rss%2Fprivate?auth=PATH_SENTINEL",
			"https://notprivate.example.com/rss/private?auth=PATH_SENTINEL",
			"https://public.example/path/private.example.com/rss/private?auth=PATH_SENTINEL",
		];
		expect(redactPrivateFeedAddresses(publicUrls, known)).toBe(publicUrls);
	});

	it("redacts a private feed with literal path escapes without changing the distinct decoded path", () => {
		const address = "https://private.example.com/rss%2Fprivate?auth=PATH_SENTINEL";
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		expect(redactPrivateFeedAddresses(`Feed ${address}.`, known)).toBe(
			"Feed podnotes-private-feed:Paid.",
		);
		const publicUrl = "https://private.example.com/rss/private?auth=PATH_SENTINEL";
		expect(redactPrivateFeedAddresses(publicUrl, known)).toBe(publicUrl);
	});

	it("decodes an encoded query value once, so its path escapes stay significant", () => {
		const address = "https://private.example.com/rss%2Fprivate?auth=PATH_SENTINEL";
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		expect(redactPrivateFeedAddresses(`?u=${encodeURIComponent(address)}`, known)).toBe(
			"?u=podnotes-private-feed%3APaid",
		);
		const decodedPath = `?u=${encodeURIComponent(decodeURIComponent(address))}`;
		expect(redactPrivateFeedAddresses(decodedPath, known)).toBe(decodedPath);
	});

	it.each([
		["scheme letters", "&#104;ttps://private.example.com/rss?auth=ENTITY_SENTINEL"],
		[
			"hex scheme",
			"&#x68;&#X74;&#x74;&#x70;&#x73;&#x3a;//private.example.com/rss?auth=ENTITY_SENTINEL",
		],
		[
			"padded numbers",
			"https&#0000058;&#x00002F;&#x2f;private.example.com/rss?auth=ENTITY_SENTINEL",
		],
		["semicolon-free numbers", "https&#58&#47&#47private.example.com/rss?auth=ENTITY_SENTINEL"],
		["scheme-less host", "private&#46;example&#x2E;com/rss?auth=ENTITY_SENTINEL"],
	])("redacts an address spelled with %s", (_, spelled) => {
		const known = new Map([
			["https://private.example.com/rss?auth=ENTITY_SENTINEL", "podnotes-private-feed:Paid"],
		]);
		expect(redactPrivateFeedAddresses(`Feed: ${spelled}&period; &amp;c`, known)).toBe(
			"Feed: podnotes-private-feed:Paid&period; &amp;c",
		);
	});

	it("never takes a known host inside another host name, path or user name", () => {
		const known = new Map([
			["https://private.example.com/rss?auth=HOST_SENTINEL", "podnotes-private-feed:Paid"],
		]);
		const publicText = [
			"notprivate.example.com/rss?auth=HOST_SENTINEL",
			"www.private.example.com/rss?auth=HOST_SENTINEL",
			"https://user@private.example.com/rss?auth=HOST_SENTINEL",
			"https://public.example/private.example.com/rss?auth=HOST_SENTINEL",
			"https://public.example\\private.example.com/rss?auth=HOST_SENTINEL",
			"feed://notprivate.example.com/rss?auth=HOST_SENTINEL",
			"https%3A%2F%2Fnotprivate.example.com%2Frss%3Fauth%3DHOST_SENTINEL",
		];
		expect(redactPrivateFeedAddresses(publicText, known)).toBe(publicText);
		expect(
			redactPrivateFeedAddresses(`?u=private.example.com/rss?auth=HOST_SENTINEL`, known),
		).toBe("?u=podnotes-private-feed:Paid");
	});

	it.each([
		["percent escape", "https%3A%2F%2Fprivate.example.com%2Frss%3Fauth%3D%E0%A4%A"],
		["character reference", "&#99999999999; &#x110000; &#xD800; private.example.com"],
	])("skips a malformed %s and keeps redacting the rest", (_, malformed) => {
		const address = "https://private.example.com/rss?auth=ESCAPE_SENTINEL";
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		expect(redactPrivateFeedAddresses({ malformed }, known)).toEqual({ malformed });
		expect(redactPrivateFeedAddresses(`${malformed} ${address}`, known)).toBe(
			`${malformed} podnotes-private-feed:Paid`,
		);
	});

	it("leaves a saved placeholder alone even when its encoded name holds the address", () => {
		const address = "https://private.example.com/rss?auth=NAME_SENTINEL";
		const placeholder = privateFeedPlaceholder(address);
		const document = { url: placeholder, quoted: encodeURIComponent(address) };
		expect(redactPrivateFeedAddresses(document, new Map([[address, placeholder]]))).toEqual({
			url: placeholder,
			quoted: encodeURIComponent(placeholder),
		});
	});

	it.each([
		"https://private.example.com./rss?auth=ALIAS_SENTINEL",
		"https:\\\\private.example.com/rss?auth=ALIAS_SENTINEL",
		"https:/\\private.example.com/rss?auth=ALIAS_SENTINEL",
		"https:///%70rivate.example.com/rss?auth=ALIAS_SENTINEL",
		"https:/private.example.com/rss?auth=ALIAS_SENTINEL",
		"https:\\private.example.com/rss?auth=ALIAS_SENTINEL",
		"HTTPS:private.example.com/rss?auth=ALIAS_SENTINEL",
	])("redacts standalone and quoted browser aliases: %s", (alias) => {
		const known = new Map([
			["https://private.example.com/rss?auth=ALIAS_SENTINEL", "podnotes-private-feed:Paid"],
		]);
		const document = {
			standalone: alias,
			quoted: `Your feed: ${alias}.`,
			episode: "https://private.example.com/episode?auth=EPISODE_TOKEN",
			media: "https://private.example.com/audio.mp3?token=MEDIA_SIGNATURE",
		};
		expect(redactPrivateFeedAddresses(document, known)).toEqual({
			...document,
			standalone: "podnotes-private-feed:Paid",
			quoted: "Your feed: podnotes-private-feed:Paid.",
		});
	});

	it("redacts an address an HTML attribute quotes with &amp;", () => {
		const known = new Map([
			[
				"https://private.example.com/rss?auth=HTML_SENTINEL&show=1",
				"podnotes-private-feed:Paid",
			],
		]);
		const html = '<a href="https://private.example.com/rss?auth=HTML_SENTINEL&amp;show=1">';
		expect(redactPrivateFeedAddresses({ description: html }, known)).toEqual({
			description: '<a href="podnotes-private-feed:Paid">',
		});
	});

	it("redacts addresses in markup escaped with the uppercase entities HTML defines", () => {
		const known = new Map([
			[
				"https://private.example.com/rss?auth=CASE_SENTINEL&show=1",
				"podnotes-private-feed:Paid",
			],
		]);
		const alias = "https://private.example.com/rss?auth=CASE_SENTINEL&AMP;show=1";
		const document = {
			attribute: `<a href="${alias}">`,
			escaped: `&LT;a href=&QUOT;${alias}&QUOT;&GT;${alias}&LT;/a&GT; &LT;${alias}&GT;`,
		};
		expect(redactPrivateFeedAddresses(document, known)).toEqual({
			attribute: '<a href="podnotes-private-feed:Paid">',
			escaped:
				"&LT;a href=&QUOT;podnotes-private-feed:Paid&QUOT;&GT;podnotes-private-feed:Paid&LT;/a&GT; &LT;podnotes-private-feed:Paid&GT;",
		});
	});

	it.each([
		["schemes", "https://private.example.com/x"],
		["encoded schemes", "https%3A%2F%2Fprivate.example.com%2Fx"],
		["feed wrappers", "feed://private.example.com/x"],
		["host query values", "=private.example.com/x"],
		["trailing dots", "."],
	])("parses a long run of repeated %s a bounded number of times", (_, unit) => {
		const address = "https://private.example.com/rss?auth=WORK_SENTINEL";
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		const run = `https://private.example.com/rss${unit.repeat(2000)}`;
		const parse = vi.mocked(checkStringIsUrl);
		parse.mockClear();
		expect(redactPrivateFeedAddresses(`Feed ${run} ${address}`, known)).toBe(
			`Feed ${run} podnotes-private-feed:Paid`,
		);
		const parsed = parse.mock.calls.reduce((total, [url]) => total + url.length, 0);
		expect(parse).toHaveBeenCalled();
		expect(parsed).toBeLessThan(10 * run.length);
	});

	it.each([
		["https://private.example.com", "https://%70rivate.example.com"],
		["https://xn--bcher-kva.example.com", "https://bücher.example.com"],
		["https://127.0.0.1", "https://2130706433"],
		["https://[::1]", "https://[0:0:0:0:0:0:0:1]"],
	])("redacts a quoted address whose authority normalizes to %s", (canonical, alias) => {
		const feedUrl = `${canonical}/rss?auth=PRIVATE_SENTINEL`;
		const episodeUrl = `${canonical}/audio.mp3?token=MEDIA_SIGNATURE`;
		const document = {
			podcastName: "Paid",
			feedUrl,
			description: `Subscribe at ${alias}/rss?auth=PRIVATE_SENTINEL.`,
			episodeUrl,
		};

		expect(redactPrivateFeedAddresses(document)).toEqual({
			podcastName: "Paid",
			feedUrl: "podnotes-private-feed:Paid",
			description: "Subscribe at podnotes-private-feed:Paid.",
			episodeUrl,
		});
	});

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

describe("candidate filtering preserves every covered address spelling", () => {
	const address = "https://private.example/rss?auth=FILTER_SENTINEL";
	const numeric = "https://127.0.0.1/rss?auth=FILTER_SENTINEL";
	const spellings: [name: string, knownAddress: string, spelling: string][] = [
		["plain", address, address],
		["HTTP", address, "http://private.example/rss?auth=FILTER_SENTINEL"],
		["feed wrapper", address, `feed:${address}`],
		["podcast wrapper", address, `podcast:${address}`],
		["scheme-less", address, "private.example/rss?auth=FILTER_SENTINEL"],
		["host case", address, "https://PRIVATE.EXAMPLE/rss?auth=FILTER_SENTINEL"],
		[
			"numeric entities",
			address,
			"https&#58;&#47;&#47;private&#46;example/rss?auth=FILTER_SENTINEL",
		],
		[
			"hex entities",
			address,
			"https&#X3A;&#x2f;&#x2f;private&#x2e;example/rss?auth=FILTER_SENTINEL",
		],
		[
			"named entities",
			address,
			"https&colon;&sol;&sol;private&period;example/rss?auth=FILTER_SENTINEL",
		],
		["percent-encoded host", address, "https://%70rivate.example/rss?auth=FILTER_SENTINEL"],
		["Unicode host", address, "https://ｐｒｉｖａｔｅ.example/rss?auth=FILTER_SENTINEL"],
		["backslashes", address, "https:\\\\private.example/rss?auth=FILTER_SENTINEL"],
		[
			"numeric feed authority",
			"https://127.0.0.1/rss?auth=FILTER_SENTINEL",
			"feed://2130706433/rss?auth=FILTER_SENTINEL",
		],
		[
			"numeric podcast authority",
			"https://127.0.0.1/rss?auth=FILTER_SENTINEL",
			"podcast://0x7f000001/rss?auth=FILTER_SENTINEL",
		],
		[
			"IPv6",
			"https://[::1]/rss?auth=FILTER_SENTINEL",
			"https://[0:0:0:0:0:0:0:1]/rss?auth=FILTER_SENTINEL",
		],
		[
			"ampersand in the host",
			"https://a&b.example/rss?auth=FILTER_SENTINEL",
			"https://a&amp;b.example/rss?auth=FILTER_SENTINEL",
		],
		["malformed mixed-case amp", `${address}&show=1`, `${address}&aMp;show=1`],
		[
			"malformed mixed-case amp in the host",
			"https://a&b.example/rss?auth=FILTER_SENTINEL",
			"https://a&aMp;b.example/rss?auth=FILTER_SENTINEL",
		],
		["numeric HTTP authority", numeric, "http://0x7f.1/rss?auth=FILTER_SENTINEL"],
		[
			"numeric authority with backslashes",
			numeric,
			"https:\\\\2130706433/rss?auth=FILTER_SENTINEL",
		],
		[
			"numeric authority after user info",
			"https://user@127.0.0.1/rss?auth=FILTER_SENTINEL",
			"https://user@2130706433/rss?auth=FILTER_SENTINEL",
		],
		[
			"uppercase punycode",
			"https://xn--bcher-kva.example/rss?auth=FILTER_SENTINEL",
			"https://XN--BCHER-KVA.EXAMPLE/rss?auth=FILTER_SENTINEL",
		],
	];
	it.each(spellings)(
		"redacts %s and preserves its distinct public address",
		(_name, knownAddress, spelling) => {
			const known = new Map([[knownAddress, "podnotes-private-feed:Paid"]]);
			const input = `Subscribe at ${spelling}.`;
			const publicText = input.replaceAll("FILTER_SENTINEL", "PUBLIC_VALUE");
			expect(redactPrivateFeedAddresses(input, known)).toBe(
				"Subscribe at podnotes-private-feed:Paid.",
			);
			expect(redactPrivateFeedAddresses(publicText, known)).toBe(publicText);
		},
	);

	it("redacts an encoded query with no literal hostname and preserves a public query", () => {
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		const input =
			"Visit https://redirect.example/?feed=https%3A%2F%2Fprivate%2Eexample%2Frss%3Fauth%3DFILTER_SENTINEL&next=1.";
		expect(redactPrivateFeedAddresses(input, known)).toBe(
			"Visit https://redirect.example/?feed=podnotes-private-feed%3APaid&next=1.",
		);
		const publicText = input.replaceAll("FILTER_SENTINEL", "PUBLIC_VALUE");
		expect(redactPrivateFeedAddresses(publicText, known)).toBe(publicText);
	});

	it("redacts an object key and leaves its own output unchanged", () => {
		for (const [, knownAddress, spelling] of spellings) {
			const known = new Map([[knownAddress, "podnotes-private-feed:Paid"]]);
			const publicText = spelling.replaceAll("FILTER_SENTINEL", "PUBLIC_VALUE");
			const safe = redactPrivateFeedAddresses(
				{ [`Subscribe at ${spelling}.`]: publicText },
				known,
			);
			expect(safe).toEqual({ "Subscribe at podnotes-private-feed:Paid.": publicText });
			expect(redactPrivateFeedAddresses(safe, known)).toBe(safe);
		}
	});

	it("decodes amp in any case, but no other entity name HTML lacks in capitals", () => {
		const known = new Map([[address, "podnotes-private-feed:Paid"]]);
		const capitals = "Subscribe at https&COLON;//private.example/rss?auth=FILTER_SENTINEL.";
		expect(redactPrivateFeedAddresses(capitals, known)).toBe(capitals);
	});
});

describe("redacting a document with repeated text", () => {
	const address = "https://private.example/rss?auth=REPEAT_SENTINEL";
	const known = new Map([[address, "podnotes-private-feed:Paid"]]);
	const prose = `Feed ${address}.`;
	// A whole field ending in a period is a distinct resource address.
	const field = `${address}.`;

	it("redacts every copy and keeps a whole field apart from prose quoting the same text", () => {
		expect(redactPrivateFeedAddresses([field, prose, field, prose], known)).toEqual([
			field,
			"Feed podnotes-private-feed:Paid.",
			field,
			"Feed podnotes-private-feed:Paid.",
		]);
		expect(redactPrivateFeedAddresses({ a: prose, b: field, [prose]: field }, known)).toEqual({
			a: "Feed podnotes-private-feed:Paid.",
			b: field,
			"Feed podnotes-private-feed:Paid.": field,
		});
	});

	it("returns an unchanged document itself and never mutates one it copies", () => {
		const publicText = prose.replace("REPEAT_SENTINEL", "PUBLIC_VALUE");
		const unchanged = { a: [publicText, publicText], b: { [publicText]: publicText } };
		expect(redactPrivateFeedAddresses(unchanged, known)).toBe(unchanged);

		const document = { a: [prose, prose], b: { [prose]: prose }, c: publicText };
		const before = structuredClone(document);
		expect(redactPrivateFeedAddresses(document, known)).toEqual({
			a: ["Feed podnotes-private-feed:Paid.", "Feed podnotes-private-feed:Paid."],
			b: { "Feed podnotes-private-feed:Paid.": "Feed podnotes-private-feed:Paid." },
			c: publicText,
		});
		expect(document).toEqual(before);
	});

	it("refuses a key collision on a repeated key", () => {
		expect(() =>
			redactPrivateFeedAddresses(
				{ a: { [prose]: 1 }, b: { [prose]: 2, "Feed podnotes-private-feed:Paid.": 3 } },
				known,
			),
		).toThrow("Private feed address protection would overwrite a saved field.");
		expect(redactPrivateFeedAddresses({ a: { [prose]: 1 }, b: { [prose]: 2 } }, known)).toEqual(
			{
				a: { "Feed podnotes-private-feed:Paid.": 1 },
				b: { "Feed podnotes-private-feed:Paid.": 2 },
			},
		);
	});

	it("takes each call's own addresses and placeholders, never an earlier call's", () => {
		const other = "https://other.example/rss?auth=OTHER_SENTINEL";
		const placeholder = (name: string) => new Map([[address, `podnotes-private-feed:${name}`]]);
		expect(redactPrivateFeedAddresses(prose, placeholder("Old"))).toBe(
			"Feed podnotes-private-feed:Old.",
		);
		expect(redactPrivateFeedAddresses(prose, placeholder("New"))).toBe(
			"Feed podnotes-private-feed:New.",
		);
		expect(
			redactPrivateFeedAddresses(prose, new Map([[other, "podnotes-private-feed:Other"]])),
		).toBe(prose);

		const snapshot = { podcastName: "Found", feedUrl: address, description: prose };
		expect(redactPrivateFeedAddresses([snapshot, prose])).toEqual([
			{
				podcastName: "Found",
				feedUrl: "podnotes-private-feed:Found",
				description: "Feed podnotes-private-feed:Found.",
			},
			"Feed podnotes-private-feed:Found.",
		]);
		expect(
			redactPrivateFeedAddresses([prose], new Map([[other, "podnotes-private-feed:Other"]])),
		).toEqual([prose]);
	});
});
