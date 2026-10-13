import { parseYaml } from "obsidian";
import { describe, expect, it } from "vitest";
import { addFrontmatterFields } from "./noteFrontmatter";

const feedUrl = "https://example.com/feed.xml";
const fields = [
	["guid", "finale-1"],
	["feedUrl", feedUrl],
] as const;

function properties(note: string): unknown {
	const [, block] = /^---\n([\s\S]*?)\n---\n/.exec(note) ?? [];
	return parseYaml(block);
}

describe("addFrontmatterFields", () => {
	it("adds a frontmatter block to content without one", () => {
		expect(addFrontmatterFields("# Finale\n", fields)).toBe(
			`---\nguid: "finale-1"\nfeedUrl: "${feedUrl}"\n---\n# Finale\n`,
		);
	});

	it("adds the fields before the closing line, keeping every existing line as written", () => {
		const frontmatter = [
			"---",
			"title: 'It''s a finale'",
			"date: 2024-01-01",
			"count: 0x1F",
			"empty:",
			"# a comment",
			"tags:",
			"  - podcast",
			"description: |",
			"  Two",
			"  lines",
		].join("\n");

		expect(addFrontmatterFields(`${frontmatter}\n---\nBody`, fields)).toBe(
			`${frontmatter}\nguid: "finale-1"\nfeedUrl: "${feedUrl}"\n---\nBody`,
		);
	});

	it.each([
		["an indented key", '---\n  guid: "mine"\n  feedUrl: "existing"\n---\n'],
		["a quoted key", `---\n"guid": "mine"\n'feedUrl': "existing"\n---\n`],
		["an escaped key", '---\n"gu\\u0069d": "mine"\n"feed\\x55rl": "existing"\n---\n'],
	])("does not repeat %s YAML reads as a field", (_, note) => {
		expect(addFrontmatterFields(note, fields)).toBe(note);
	});

	it("adds only the field an escaped key does not spell", () => {
		const note = '---\n"gu\\u0069d": "mine"\n---\n';

		const result = addFrontmatterFields(note, fields);

		expect(result).toBe(`---\n"gu\\u0069d": "mine"\nfeedUrl: "${feedUrl}"\n---\n`);
		expect(properties(result)).toEqual({ guid: "mine", feedUrl });
	});

	it("indents the fields like a mapping indented by two spaces", () => {
		const note = '---\n# Episode\n  title: "Finale"\n  tags:\n    - podcast\n---\n# Finale';

		const result = addFrontmatterFields(note, fields);

		expect(result).toBe(
			`---\n# Episode\n  title: "Finale"\n  tags:\n    - podcast\n  guid: "finale-1"\n  feedUrl: "${feedUrl}"\n---\n# Finale`,
		);
		expect(properties(result)).toEqual({
			title: "Finale",
			tags: ["podcast"],
			guid: "finale-1",
			feedUrl,
		});
	});

	it("adds the fields to frontmatter that holds only a comment", () => {
		expect(addFrontmatterFields("---\n# Filled in later\n---\n", fields)).toBe(
			`---\n# Filled in later\nguid: "finale-1"\nfeedUrl: "${feedUrl}"\n---\n`,
		);
	});

	it.each([
		["a flow mapping", "---\n{a: 1}\n---\n# Finale"],
		["invalid YAML", "---\ntitle: [unclosed\n---\n# Finale"],
		["a list", "---\n- one\n- two\n---\n# Finale"],
		["a scalar", "---\njust text\n---\n# Finale"],
	])("leaves %s as it is", (_, note) => {
		expect(addFrontmatterFields(note, fields)).toBe(note);
	});
});
