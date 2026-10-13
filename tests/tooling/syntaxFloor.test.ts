import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { syntaxFloor } from "../../scripts/syntax-floor";

describe("syntaxFloor", () => {
	let dir: string;
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it("fails a build whose output has a class field before main.js is written", async () => {
		dir = mkdtempSync(join(tmpdir(), "podnotes-syntax-floor-"));
		const entry = join(dir, "entry.js");
		writeFileSync(entry, "export class A { x = 1; }\n");

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
		).rejects.toThrow(/main\.js uses syntax Safari 15 cannot run/);
		expect(existsSync(join(dir, "out", "main.js"))).toBe(false);
	});
});
