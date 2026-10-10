import * as path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Node tests compile Svelte for the server, where $state is a plain object, not
// a proxy. Fail loudly instead of letting a test check server semantics.
const svelteNeedsJsdom: Plugin = {
	name: "svelte-needs-jsdom",
	enforce: "pre",
	transform(_code, id) {
		if (this.environment.name !== "client" && /\.svelte(\.[jt]s)?$/.test(id.split("?")[0])) {
			this.error(
				`${id} is Svelte code; add \`// @vitest-environment jsdom\` to the test file that loads it.`,
			);
		}
	},
};

export default defineConfig({
	plugins: [svelteNeedsJsdom, svelte()],
	resolve: {
		alias: {
			src: path.resolve("./src"),
			obsidian: path.resolve("./tests/mocks/obsidian.ts"),
		},
		conditions: ["browser"],
	},
	test: {
		include: [
			"src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
			"scripts/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}",
		],
		globals: true,
		// Files that need a DOM or load Svelte code opt in with
		// `// @vitest-environment jsdom`. Creating a jsdom environment per file is
		// the suite's largest cost.
		environmentOptions: {
			jsdom: {
				url: "https://podnotes.test/",
			},
		},
		setupFiles: ["./vitest.setup.ts"],
	},
});
