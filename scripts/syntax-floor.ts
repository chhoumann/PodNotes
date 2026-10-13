import { parse } from "acorn";
import type { Plugin } from "vite";

const LOOKBEHIND = /\(\?<[=!]/;

/**
 * Obsidian's Android app sets no WebView minimum, and its own code parses as
 * ES2020, so main.js must too. The iOS app still supports Safari 15, which
 * mis-scopes some class field initializers (WebKit bug 236843) and lacks
 * regular expression lookbehind, which compilers cannot lower.
 */
export function assertSupportedSyntax(fileName: string, code: string): void {
	let ast: ReturnType<typeof parse>;
	try {
		ast = parse(code, {
			ecmaVersion: 2020,
			sourceType: "script",
			onToken(token) {
				if (
					token.type.label === "regexp" &&
					LOOKBEHIND.test(code.slice(token.start, token.end))
				) {
					throw new SyntaxError(`Regular expression lookbehind at ${token.start}`);
				}
			},
		});
	} catch (error) {
		throw new Error(
			`${fileName} uses syntax newer than ES2020 or Safari 15: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	const pending: unknown[] = [ast];
	while (pending.length) {
		const node = pending.pop();
		if (typeof node !== "object" || node === null) continue;
		if (
			"type" in node &&
			node.type === "TaggedTemplateExpression" &&
			"start" in node &&
			typeof node.start === "number"
		) {
			const offset = Buffer.byteLength(code.slice(0, node.start), "utf8");
			throw new Error(
				`${fileName} contains a tagged template at byte offset ${offset}: tagged templates disable Obsidian's eval cache for the whole plugin; use a plain string`,
			);
		}
		pending.push(...Object.values(node));
	}
}

export function syntaxFloor(): Plugin {
	return {
		name: "podnotes-syntax-floor",
		generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				if (output.type === "chunk") assertSupportedSyntax(output.fileName, output.code);
			}
		},
	};
}
