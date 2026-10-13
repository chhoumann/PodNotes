import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { syntaxFloor } from "../../scripts/syntax-floor";

describe("syntaxFloor", () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it.each([
		[
			"a class field",
			"export class A { x = 1; }\n",
			/main\.js uses syntax newer than ES2020 or Safari 15/,
		],
		[
			"String.raw",
			"export const text = String.raw`text`;\n",
			/main\.js contains a tagged template at byte offset \d+: tagged templates disable Obsidian's eval cache for the whole plugin; use a plain string/,
		],
		[
			"a custom tag in an uncalled function",
			"export function unused() { return tag`text`; }\n",
			/main\.js contains a tagged template at byte offset \d+: tagged templates disable Obsidian's eval cache for the whole plugin; use a plain string/,
		],
	])(
		"fails a build whose output has %s before main.js is written",
		async (_name, code, error) => {
			dir = mkdtempSync(join(tmpdir(), "podnotes-syntax-floor-"));
			const entry = join(dir, "entry.js");
			writeFileSync(entry, code);

			await expect(
				build({
					configFile: false,
					logLevel: "silent",
					root: dir,
					plugins: [syntaxFloor()],
					build: {
						lib: { entry, formats: ["cjs"], fileName: () => "main.js" },
						target: "esnext",
						outDir: join(dir, "out"),
						minify: false,
					},
				}),
			).rejects.toThrow(error);
			expect(existsSync(join(dir, "out", "main.js"))).toBe(false);
		},
	);
});
