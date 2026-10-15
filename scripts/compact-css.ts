import postcss from "postcss";

export function compactCss(css: string): string {
	const root = postcss.parse(css);
	const whitespace = /^[ \t\n\r\f]*$/;
	root.walk((node) => {
		if (node.type === "rule" || node.type === "atrule") node.raws.semicolon = false;
		if (whitespace.test(node.raws.before ?? "")) node.raws.before = "";
		if (
			(node.type === "rule" || node.type === "atrule") &&
			whitespace.test(node.raws.after ?? "")
		)
			node.raws.after = "";
		if (
			node.type === "decl" &&
			!node.prop.startsWith("--") &&
			/^[ \t\n\r\f]*:[ \t\n\r\f]*$/.test(node.raws.between ?? "")
		) {
			node.raws.between = ":";
		} else if (
			(node.type === "rule" || node.type === "atrule") &&
			whitespace.test(node.raws.between ?? "")
		) {
			node.raws.between = "";
		}
	});
	if (whitespace.test(root.raws.after ?? "")) root.raws.after = "";
	return root.toString();
}
