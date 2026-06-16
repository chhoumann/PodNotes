import { describe, expect, it } from "vitest";
import {
	FALLBACK_BASENAME,
	MAX_FILENAME_BYTES,
	enforceMaxPathLength,
} from "./enforceMaxPathLength";

const lastSegment = (path: string) => path.split("/").pop() ?? "";
const byteLength = (value: string) => new TextEncoder().encode(value).length;

describe("enforceMaxPathLength", () => {
	it("leaves a short, valid path untouched", () => {
		expect(enforceMaxPathLength("PodNotes/My Show/Episode 1.md")).toBe(
			"PodNotes/My Show/Episode 1.md",
		);
	});

	it("caps an over-long file name at 255 bytes, keeping folders and extension", () => {
		const longTitle = "A".repeat(400);
		const result = enforceMaxPathLength(`PodNotes/My Show/${longTitle}.md`);

		expect(result.startsWith("PodNotes/My Show/")).toBe(true);
		expect(result.endsWith(".md")).toBe(true);
		// The file name component (not the whole path) is what must fit.
		expect(byteLength(lastSegment(result))).toBeLessThanOrEqual(
			MAX_FILENAME_BYTES,
		);
		// Pure ASCII: 252 base bytes + ".md" fills the budget exactly.
		expect(lastSegment(result)).toBe(`${"A".repeat(252)}.md`);
	});

	it("preserves the extension exactly (never truncates into it)", () => {
		const result = enforceMaxPathLength(`${"x".repeat(300)}.md`);
		expect(result.endsWith(".md")).toBe(true);
		expect(byteLength(result)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
	});

	it("budgets by bytes, not characters, for multibyte titles (Android/ext4)", () => {
		// "界" is 3 UTF-8 bytes; 252 of them are 756 bytes — a char-based cap would
		// leave a name that still trips ENAMETOOLONG on ext4/Android.
		const result = enforceMaxPathLength(`${"界".repeat(252)}.md`);
		expect(result.endsWith(".md")).toBe(true);
		expect(byteLength(result)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
		// 252 bytes / 3 bytes-per-char = 84 characters fit before ".md".
		expect(lastSegment(result)).toBe(`${"界".repeat(84)}.md`);
	});

	it("never splits a surrogate pair at the truncation boundary", () => {
		// Emoji are surrogate pairs (4 UTF-8 bytes). A naive .length/charAt cut
		// could keep a lone half; truncation must stay on code-point boundaries.
		const result = enforceMaxPathLength(`${"😀".repeat(100)}.md`);
		const name = lastSegment(result);
		expect(name.endsWith(".md")).toBe(true);
		expect(byteLength(name)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
		// No lone surrogate: the string round-trips through UTF-8 unchanged.
		expect(name).toBe(Buffer.from(name, "utf8").toString("utf8"));
		expect(/[\uD800-\uDFFF]/.test(name.replace(/(\uD83D[\uDE00-\uDE4F])/g, "")))
			.toBe(false);
	});

	it("substitutes a fallback when the title is empty (bare extension)", () => {
		// An all-illegal-character title sanitizes to "", leaving "<folder>/.md".
		expect(enforceMaxPathLength("PodNotes/My Show/.md")).toBe(
			`PodNotes/My Show/${FALLBACK_BASENAME}.md`,
		);
	});

	it("substitutes a fallback for a degenerate, segment-less path", () => {
		expect(enforceMaxPathLength(".md")).toBe(`${FALLBACK_BASENAME}.md`);
		expect(enforceMaxPathLength("")).toBe(`${FALLBACK_BASENAME}.md`);
	});

	it("always reattaches the extension even when the input lacks it", () => {
		// Defensive: addExtension normally runs first, but the helper must still
		// yield a Markdown note if handed a bare path.
		expect(enforceMaxPathLength("PodNotes/Episode 1")).toBe(
			"PodNotes/Episode 1.md",
		);
	});

	it("drops empty segments from leading/trailing/double slashes", () => {
		expect(enforceMaxPathLength("PodNotes//My Show/Episode 1.md")).toBe(
			"PodNotes/My Show/Episode 1.md",
		);
		expect(enforceMaxPathLength("/PodNotes/Episode 1.md")).toBe(
			"PodNotes/Episode 1.md",
		);
	});

	it("trims trailing dots/spaces that truncation exposes (illegal on Windows)", () => {
		// Force the cut to land right after a space, then a dot.
		const result = enforceMaxPathLength(`${"A".repeat(251)} tail.md`);
		const name = lastSegment(result).replace(/\.md$/, "");
		expect(name.endsWith(".")).toBe(false);
		expect(name.endsWith(" ")).toBe(false);
		// Trimming can leave the name under the budget — the guarantee is "<=".
		expect(byteLength(lastSegment(result))).toBeLessThanOrEqual(
			MAX_FILENAME_BYTES,
		);
	});

	it("keeps interior dots in ordinary titles", () => {
		expect(enforceMaxPathLength("PodNotes/Episode 1.5.md")).toBe(
			"PodNotes/Episode 1.5.md",
		);
	});

	it("caps a pathologically long folder segment too", () => {
		const longFolder = "F".repeat(400);
		const result = enforceMaxPathLength(`${longFolder}/Episode 1.md`);
		expect(byteLength(result.split("/")[0])).toBeLessThanOrEqual(
			MAX_FILENAME_BYTES,
		);
		expect(lastSegment(result)).toBe("Episode 1.md");
	});

	it("supports a non-default extension", () => {
		const result = enforceMaxPathLength(`${"a".repeat(300)}.mp3`, ".mp3");
		expect(result.endsWith(".mp3")).toBe(true);
		expect(byteLength(result)).toBeLessThanOrEqual(MAX_FILENAME_BYTES);
	});

	it("is deterministic: two titles sharing the truncated prefix map to one path", () => {
		// Documented tradeoff (issue #22 wants the same title -> same note name):
		// titles that agree on the capped prefix collide. createPodcastNote then
		// surfaces the existing note ("already exists") rather than failing.
		const a = enforceMaxPathLength(`Pod/${"Z".repeat(300)}-alpha.md`);
		const b = enforceMaxPathLength(`Pod/${"Z".repeat(300)}-beta.md`);
		expect(a).toBe(b);
	});
});
