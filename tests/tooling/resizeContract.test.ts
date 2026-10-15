// @vitest-environment jsdom
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "vite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();

describe("Svelte resize bindings in the production build", { timeout: 20_000 }, () => {
	let dir: string;

	beforeEach(() => {
		const scratch = path.join(root, ".obsidian-e2e-artifacts");
		mkdirSync(scratch, { recursive: true });
		dir = mkdtempSync(path.join(scratch, "resize-contract-"));
		vi.stubEnv("NODE_ENV", "production");
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.unstubAllEnvs();
		rmSync(dir, { recursive: true, force: true });
	});

	async function buildComponent(source: string) {
		writeFileSync(path.join(dir, "Component.svelte"), source);
		writeFileSync(path.join(dir, "effect.js"), "globalThis.podnotesToolingEffect = true;");
		const entry = path.join(dir, "entry.js");
		writeFileSync(
			entry,
			`
			import { mount, unmount, flushSync } from "svelte";
			import Component from "./Component.svelte";
			import "./effect.js";
			export function didImportEffect() { return globalThis.podnotesToolingEffect === true; }
			export { flushSync };
			export function start(target) {
				const instance = mount(Component, { target });
				flushSync();
				return () => unmount(instance);
			}
		`,
		);
		const result = await build({
			configFile: path.join(root, "vite.config.ts"),
			configLoader: "bundle",
			mode: "production",
			logLevel: "silent",
			build: { write: false, lib: { entry } },
		});
		if (!Array.isArray(result)) throw new Error("Expected library build outputs");
		const chunk = result
			.flatMap((result) => result.output)
			.find((output) => output.fileName === "main.js");
		if (chunk?.type !== "chunk") throw new Error("Expected a JavaScript chunk");
		return chunk.code;
	}

	it("omits ResizeObserver when no component binds its size", async () => {
		const code = await buildComponent("<p>Plain markup</p>");
		expect(code).not.toContain("ResizeObserver");
	});

	it("updates a used size binding and stops observing when unmounted", async () => {
		let resize: ((entries: { target: Element }[]) => void) | undefined;
		const observe = vi.fn();
		const unobserve = vi.fn();
		vi.stubGlobal(
			"ResizeObserver",
			class {
				constructor(callback: typeof resize) {
					resize = callback;
				}
				observe = observe;
				unobserve = unobserve;
			},
		);
		const code = await buildComponent(
			"<script>let width = $state(0);</script><div bind:clientWidth={width}>{width}</div>",
		);
		vi.stubGlobal("podnotesToolingEffect", false);
		const exports: {
			start?: (target: HTMLElement) => () => Promise<void>;
			flushSync?: () => void;
			didImportEffect?: () => boolean;
		} = {};
		new Function("exports", "module", code)(exports, { exports });
		expect(exports.didImportEffect?.()).toBe(true);
		const target = document.createElement("div");
		document.body.append(target);
		const cleanup = exports.start?.(target);
		const element = target.firstElementChild;
		try {
			if (!element) throw new Error("The component did not mount");
			expect(observe).toHaveBeenCalledExactlyOnceWith(element, { box: "border-box" });
			Object.defineProperty(element, "clientWidth", { value: 240 });
			resize?.([{ target: element }]);
			exports.flushSync?.();
			expect(element.textContent).toBe("240");
		} finally {
			await cleanup?.();
			target.remove();
		}
		expect(unobserve).toHaveBeenCalledExactlyOnceWith(element);
	});
});
