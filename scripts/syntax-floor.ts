import { parse } from "acorn";
import type { Plugin } from "vite";

/**
 * The Obsidian iOS app still supports Safari 15, which mis-scopes some class
 * field initializers (WebKit bug 236843). ES2021 is the newest edition without
 * class fields, so a bundle that parses as ES2021 is safe whatever the
 * compiler's target tables say.
 */
export function assertEs2021(fileName: string, code: string): void {
	try {
		parse(code, { ecmaVersion: 2021, sourceType: "script" });
	} catch (error) {
		throw new Error(`${fileName} uses syntax newer than ES2021: ${(error as Error).message}`);
	}
}

export function syntaxFloor(): Plugin {
	return {
		name: "podnotes-syntax-floor",
		generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				if (output.type === "chunk") assertEs2021(output.fileName, output.code);
			}
		},
	};
}
