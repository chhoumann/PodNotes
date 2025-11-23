import * as path from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sveltePreprocess from "svelte-preprocess";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [
		svelte({
			hot: !process.env.VITEST,
			preprocess: sveltePreprocess(),
		}),
	],
	resolve: {
		alias: {
			src: path.resolve("./src"),
		},
		conditions: ["browser"],
	},
	test: {
		include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		globals: true,
		environment: "jsdom",
	},
});
