import { afterEach, describe, expect, it } from "vitest";
import { Platform } from "obsidian";
import {
	FALLBACK_BASENAME,
	type FilenameLimit,
	MAX_FILENAME_UNITS,
	enforceMaxPathLength,
	getPlatformFilenameLimit,
} from "./enforceMaxPathLength";

const lastSegment = (path: string) => path.split("/").pop() ?? "";
const byteLength = (value: string) => new TextEncoder().encode(value).length;

const BYTES: FilenameLimit = { mode: "bytes", max: MAX_FILENAME_UNITS };
const UTF16: FilenameLimit = { mode: "utf16", max: MAX_FILENAME_UNITS };

describe("enforceMaxPathLength", () => {
	it("leaves a short, valid path untouched", () => {
		expect(enforceMaxPathLength("PodNotes/My Show/Episode 1.md", ".md", BYTES)).toBe(
			"PodNotes/My Show/Episode 1.md",
		);
	});

	it("caps an over-long ASCII file name at 255, keeping folders and extension", () => {
		const longTitle = "A".repeat(400);
		const result = enforceMaxPathLength(
			`PodNotes/My Show/${longTitle}.md`,
			".md",
			BYTES,
		);

		expect(result.startsWith("PodNotes/My Show/")).toBe(true);
		expect(result.endsWith(".md")).toBe(true);
		expect(byteLength(lastSegment(result))).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
		// 252 base bytes + ".md" fills the budget exactly.
		expect(lastSegment(result)).toBe(`${"A".repeat(252)}.md`);
	});

	it("preserves the extension exactly (never truncates into it)", () => {
		const result = enforceMaxPathLength(`${"x".repeat(300)}.md`, ".md", BYTES);
		expect(result.endsWith(".md")).toBe(true);
		expect(byteLength(result)).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
	});

	describe("bytes mode (ext4 / Android)", () => {
		it("budgets by bytes for multibyte titles", () => {
			// "界" is 3 UTF-8 bytes; a char-based cap would leave a name that still
			// trips ENAMETOOLONG on ext4/Android.
			const result = enforceMaxPathLength(`${"界".repeat(252)}.md`, ".md", BYTES);
			expect(byteLength(result)).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
			// 252 bytes / 3 bytes-per-char = 84 characters fit before ".md".
			expect(lastSegment(result)).toBe(`${"界".repeat(84)}.md`);
		});

		it("never splits a surrogate pair at the truncation boundary", () => {
			const result = enforceMaxPathLength(`${"😀".repeat(100)}.md`, ".md", BYTES);
			const name = lastSegment(result);
			expect(name.endsWith(".md")).toBe(true);
			expect(byteLength(name)).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
			// Round-trips through UTF-8 unchanged -> no lone surrogate.
			expect(name).toBe(Buffer.from(name, "utf8").toString("utf8"));
		});
	});

	describe("utf16 mode (NTFS / APFS)", () => {
		it("budgets by UTF-16 units, allowing full-length multibyte names", () => {
			// On APFS a 255-unit CJK name (~750 bytes) is legal; bytes-mode would
			// needlessly truncate it to 84 chars.
			const result = enforceMaxPathLength(`${"界".repeat(300)}.md`, ".md", UTF16);
			expect(lastSegment(result).length).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
			expect(lastSegment(result)).toBe(`${"界".repeat(252)}.md`);
		});

		it("keeps an astral char whole (2 UTF-16 units) at the boundary", () => {
			// 251 'A' (251 units) + ".md" (3) leaves 1 unit of budget; a 2-unit emoji
			// must NOT be half-included.
			const result = enforceMaxPathLength(`${"A".repeat(251)}😀X.md`, ".md", UTF16);
			const name = lastSegment(result);
			expect(name.length).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
			expect(name).toBe(Buffer.from(name, "utf8").toString("utf8"));
			expect(name).toBe(`${"A".repeat(251)}.md`); // emoji dropped, no half-pair
		});
	});

	it("substitutes a fallback when the title is empty (bare extension)", () => {
		expect(enforceMaxPathLength("PodNotes/My Show/.md", ".md", BYTES)).toBe(
			`PodNotes/My Show/${FALLBACK_BASENAME}.md`,
		);
	});

	it("substitutes a fallback for a degenerate, segment-less path", () => {
		expect(enforceMaxPathLength(".md", ".md", BYTES)).toBe(`${FALLBACK_BASENAME}.md`);
		expect(enforceMaxPathLength("", ".md", BYTES)).toBe(`${FALLBACK_BASENAME}.md`);
	});

	it("always reattaches the extension even when the input lacks it", () => {
		expect(enforceMaxPathLength("PodNotes/Episode 1", ".md", BYTES)).toBe(
			"PodNotes/Episode 1.md",
		);
	});

	it("drops empty segments from leading/trailing/double slashes", () => {
		expect(
			enforceMaxPathLength("PodNotes//My Show/Episode 1.md", ".md", BYTES),
		).toBe("PodNotes/My Show/Episode 1.md");
		expect(enforceMaxPathLength("/PodNotes/Episode 1.md", ".md", BYTES)).toBe(
			"PodNotes/Episode 1.md",
		);
	});

	it("trims trailing dots/spaces that truncation exposes (illegal on Windows)", () => {
		const result = enforceMaxPathLength(`${"A".repeat(251)} tail.md`, ".md", BYTES);
		const name = lastSegment(result).replace(/\.md$/, "");
		expect(name.endsWith(".")).toBe(false);
		expect(name.endsWith(" ")).toBe(false);
		expect(byteLength(lastSegment(result))).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
	});

	it("keeps interior dots in ordinary titles", () => {
		expect(enforceMaxPathLength("PodNotes/Episode 1.5.md", ".md", BYTES)).toBe(
			"PodNotes/Episode 1.5.md",
		);
	});

	it("caps a pathologically long folder segment too", () => {
		const result = enforceMaxPathLength(`${"F".repeat(400)}/Episode 1.md`, ".md", BYTES);
		expect(byteLength(result.split("/")[0])).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
		expect(lastSegment(result)).toBe("Episode 1.md");
	});

	it("supports a non-default extension", () => {
		const result = enforceMaxPathLength(`${"a".repeat(300)}.mp3`, ".mp3", BYTES);
		expect(result.endsWith(".mp3")).toBe(true);
		expect(byteLength(result)).toBeLessThanOrEqual(MAX_FILENAME_UNITS);
	});

	it("is deterministic: two titles sharing the truncated prefix map to one path", () => {
		// Documented tradeoff (issue #22 wants the same title -> same note name):
		// titles that agree on the capped prefix collide. createPodcastNote then
		// surfaces the existing note ("already exists") rather than failing.
		const a = enforceMaxPathLength(`Pod/${"Z".repeat(300)}-alpha.md`, ".md", BYTES);
		const b = enforceMaxPathLength(`Pod/${"Z".repeat(300)}-beta.md`, ".md", BYTES);
		expect(a).toBe(b);
	});
});

describe("getPlatformFilenameLimit", () => {
	const original = { ...Platform };
	const setPlatform = (flags: Partial<typeof Platform>) =>
		Object.assign(Platform, { isWin: false, isMacOS: false, isLinux: false, isIosApp: false, isAndroidApp: false }, flags);

	afterEach(() => {
		Object.assign(Platform, original);
	});

	it("uses UTF-16 units on Windows, macOS and iOS (NTFS/APFS)", () => {
		for (const flag of ["isWin", "isMacOS", "isIosApp"] as const) {
			setPlatform({ [flag]: true });
			expect(getPlatformFilenameLimit()).toEqual({ mode: "utf16", max: 255 });
		}
	});

	it("uses bytes on Linux and Android, and as the safe default (ext4/F2FS)", () => {
		setPlatform({ isLinux: true });
		expect(getPlatformFilenameLimit()).toEqual({ mode: "bytes", max: 255 });
		setPlatform({ isAndroidApp: true });
		expect(getPlatformFilenameLimit()).toEqual({ mode: "bytes", max: 255 });
		setPlatform({});
		expect(getPlatformFilenameLimit()).toEqual({ mode: "bytes", max: 255 });
	});
});
