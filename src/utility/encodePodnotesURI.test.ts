import { describe, expect, test } from "vitest";
import encodePodnotesURI from "./encodePodnotesURI";

function param(href: string, key: string): string {
	const match = href.match(new RegExp(`[?&]${key}=([^&]*)`));
	if (!match) throw new Error(`missing query param: ${key}`);
	return match[1];
}

// Obsidian decodes protocol query values with decodeURIComponent only (no '+' -> space).
function obsidianDecode(href: string, key: string): string {
	return decodeURIComponent(param(href, key));
}

describe("encodePodnotesURI", () => {
	test("encodes spaces as %20 and a literal '+' as %2B, and href preserves them", () => {
		const url = encodePodnotesURI(
			"Episode 50: C++ Tips",
			"https://pod.example.com/feed.xml",
			30,
		);

		expect(param(url.href, "episodeName")).toBe("Episode%2050%3A%20C%2B%2B%20Tips");
		// Spaces must never be serialized as '+' (Obsidian would not turn them back into spaces).
		expect(url.href).not.toContain("episodeName=Episode+50");
		expect(param(url.href, "time")).toBe("30");
	});

	test("round-trips titles losslessly through Obsidian's decodeURIComponent", () => {
		const titles = [
			"695: The Crystal Pepsi of Aqua",
			"Episode 50: C++ Tips",
			"A+ Players",
			"Q1+Q2 Recap",
			"100% Real",
			"Title & More",
		];

		for (const title of titles) {
			const url = encodePodnotesURI(title, "https://x/feed", 0);
			expect(obsidianDecode(url.href, "episodeName")).toBe(title);
		}
	});

	test("round-trips a feed url / local path containing a literal '+'", () => {
		const url = encodePodnotesURI("Ep", "Notes+/C++ Tips.mp3", 5);
		expect(obsidianDecode(url.href, "url")).toBe("Notes+/C++ Tips.mp3");
	});

	test("omits the time param when time is undefined", () => {
		const url = encodePodnotesURI("Title", "https://x/feed");
		expect(url.href).not.toContain("time=");
	});

	test("encodes segment end time when a start time is present", () => {
		const url = encodePodnotesURI("Title", "https://x/feed", 115, 125);
		expect(param(url.href, "time")).toBe("115");
		expect(param(url.href, "endTime")).toBe("125");
	});

	test("omits segment end time when no start time is present", () => {
		const url = encodePodnotesURI("Title", "https://x/feed", undefined, 125);
		expect(url.href).not.toContain("time=");
		expect(url.href).not.toContain("endTime=");
	});
});
