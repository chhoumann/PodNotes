import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));

describe("Svelte size guards in the production build", { timeout: 20_000 }, () => {
	let dir: string;

	beforeEach(() => {
		const scratch = path.join(root, ".obsidian-e2e-artifacts");
		mkdirSync(scratch, { recursive: true });
		dir = mkdtempSync(path.join(scratch, "svelte-size-guards-"));
		vi.stubEnv("NODE_ENV", "production");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(dir, { recursive: true, force: true });
	});

	function buildComponent(source: string, extra = "") {
		writeFileSync(path.join(dir, "Component.svelte"), source);
		const entry = path.join(dir, "entry.js");
		writeFileSync(
			entry,
			`export { default as Component } from "./Component.svelte";\n${extra}`,
		);
		return build({
			configFile: path.join(root, "vite.config.ts"),
			configLoader: "bundle",
			mode: "production",
			logLevel: "silent",
			build: { write: false, lib: { entry } },
		});
	}

	it.each([
		["no runes syntax", "<p>Plain markup</p>"],
		[
			"a string class",
			'<script>let { name } = $props();</script><p class="item {name}">Text</p>',
		],
		[
			"a class directive",
			"<script>let { active } = $props();</script><p class:active>Text</p>",
		],
	])("accepts a component with %s", async (_name, source) => {
		await expect(buildComponent(source)).resolves.toBeDefined();
	});

	it("rejects legacy prop declarations", async () => {
		await expect(
			buildComponent("<script>export let value;</script><p>{value}</p>"),
		).rejects.toThrow(/Cannot use.*export let.*runes mode/);
	});

	it("rejects a dynamic class that retains clsx after minification", async () => {
		await expect(
			buildComponent(
				"<script>let { classes } = $props();</script><p class={classes}>Text</p>",
			),
		).rejects.toThrow(/main\.js.*includes clsx/);
	});

	it("rejects a direct clsx dependency", async () => {
		await expect(
			buildComponent("<p>Plain markup</p>", 'export { clsx } from "clsx";'),
		).rejects.toThrow(/main\.js.*includes clsx/);
	});
});
