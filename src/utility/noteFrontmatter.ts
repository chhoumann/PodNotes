/**
 * Adds each field the content's frontmatter lacks, before its closing line, or as a new
 * frontmatter block when the content has none.
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
	const frontmatter = end > 0 ? lines.slice(1, end) : [];
	const added = fields
		.filter(
			([key]) => !frontmatter.some((line) => new RegExp(`^(["']?)${key}\\1\\s*:`).test(line)),
		)
		.map(([key, value]) => `${key}: ${yamlString(value)}`);

	if (!added.length) return content;
	if (end < 0) return `---\n${added.join("\n")}\n---\n${content}`;
	lines.splice(end, 0, ...added);
	return lines.join("\n");
}

// A JSON string is a YAML double-quoted scalar once the characters YAML rejects raw are escaped.
function yamlString(value: string): string {
	return JSON.stringify(value).replace(
		/[\u007f-\u009f\ufffe\uffff]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}
