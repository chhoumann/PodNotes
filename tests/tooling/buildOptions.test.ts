import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "vite";
import { expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

it("preserves getter reads and compact injected CSS through the production build", async () => {
	const scratch = path.join(root, ".obsidian-e2e-artifacts");
	mkdirSync(scratch, { recursive: true });
	const dir = mkdtempSync(path.join(scratch, "build-options-"));
	vi.stubEnv("NODE_ENV", "production");
	try {
		writeFileSync(
			path.join(dir, "Component.svelte"),
			'<div class="fixture">Example</div><style>.fixture { --empty: ; width: calc(100% - 2px); }</style>',
		);
		const entry = path.join(dir, "entry.js");
		writeFileSync(
			entry,
			`export { default as Component } from "./Component.svelte";
			export function readGetter(object) { object.current; }`,
		);
		const result = await build({
			configFile: path.join(root, "vite.config.ts"),
			configLoader: "bundle",
			mode: "production",
			logLevel: "silent",
			plugins: [
				{
					name: "assert-production",
					configResolved(config) {
						expect(config.isProduction).toBe(true);
					},
				},
			],
			build: { write: false, lib: { entry } },
		});
		if (!Array.isArray(result)) throw new Error("Expected library build outputs");
		const output = result.flatMap((chunk) => chunk.output);
		expect(output.map((chunk) => chunk.fileName)).toEqual(["main.js"]);
		const chunk = output[0];
		if (chunk?.type !== "chunk") throw new Error("Expected a JavaScript chunk");
		expect(chunk.code).toMatch(/\.fixture\.pn-[a-z0-9]+\{--empty: ;width:calc\(100% - 2px\)\}/);
		const exports: { readGetter?: (object: { current: number }) => void } = {};
		runInNewContext(chunk.code, { exports, module: { exports } });
		let reads = 0;
		exports.readGetter?.({
			get current() {
				return ++reads;
			},
		});
		expect(reads).toBe(1);
	} finally {
		vi.unstubAllEnvs();
		rmSync(dir, { recursive: true, force: true });
	}
}, 20_000);
