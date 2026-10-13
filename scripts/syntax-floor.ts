import { parse } from "acorn";
import type { Plugin } from "vite";

const LOOKBEHIND = /\(\?<[=!]/;

/**
 * The Obsidian iOS app still supports Safari 15. It mis-scopes some class field
 * initializers (WebKit bug 236843) and lacks regular expression lookbehind,
 * which compilers cannot lower. ES2021 is the newest edition without class
 * fields, and lookbehind is the only older syntax Safari 15 cannot parse.
 */
export function assertSafari15Syntax(fileName: string, code: string): void {
	try {
		parse(code, {
			ecmaVersion: 2021,
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
			`${fileName} uses syntax Safari 15 cannot run: ${(error as Error).message}`,
		);
	}
}

export function syntaxFloor(): Plugin {
	return {
		name: "podnotes-syntax-floor",
		generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				if (output.type === "chunk") assertSafari15Syntax(output.fileName, output.code);
			}
		},
	};
}
