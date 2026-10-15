import { parseYaml } from "obsidian";
import { isPlainObject } from "src/utility/isPlainObject";

/**
 * Adds each field the content's frontmatter lacks, before its closing line, or as a new
 * frontmatter block when the content has none. Frontmatter that is not a YAML mapping, or
 * would not read back as the same mapping plus the fields, is left as it is.
 */
export function addFrontmatterFields(
	content: string,
	fields: ReadonlyArray<readonly [string, string]>,
): string {
	const lines = content.split("\n");
	const end =
		lines[0].trim() === "---"
			? lines.findIndex((line, index) => index > 0 && line.trim() === "---")
			: -1;
	if (end < 0) return `---\n${fieldLines(fields, "").join("\n")}\n---\n${content}`;

	const frontmatter = lines.slice(1, end);
	const existing = parseMapping(frontmatter);
	if (!existing) return content;
	const missing = fields.filter(([key]) => !Object.prototype.hasOwnProperty.call(existing, key));
	if (!missing.length) return content;

	// Keys indented like the mapping's first key stay in that mapping.
	const firstKey = frontmatter.find((line) => line.trim() && !line.trimStart().startsWith("#"));
	const indent = firstKey ? firstKey.slice(0, firstKey.length - firstKey.trimStart().length) : "";
	const added = fieldLines(missing, indent);
	const result = parseMapping([...frontmatter, ...added]);
	const intact =
		result &&
		Object.entries(existing).every(
			([key, value]) => JSON.stringify(result[key]) === JSON.stringify(value),
		) &&
		missing.every(([key, value]) => result[key] === value);
	if (!intact) return content;

	lines.splice(end, 0, ...added);
	return lines.join("\n");
}

function fieldLines(fields: ReadonlyArray<readonly [string, string]>, indent: string): string[] {
	return fields.map(([key, value]) => `${indent}${key}: ${yamlString(value)}`);
}

/** The lines' YAML as a mapping, empty for no YAML, or undefined for anything else. */
function parseMapping(lines: readonly string[]): Record<string, unknown> | undefined {
	try {
		const parsed: unknown = parseYaml(lines.join("\n")) ?? {};
		return isPlainObject(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

// A JSON string is a YAML double-quoted scalar once the characters YAML rejects raw are escaped.
function yamlString(value: string): string {
	return JSON.stringify(value).replace(
		/[\u007f-\u009f\ufffe\uffff]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}
