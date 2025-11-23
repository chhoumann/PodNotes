import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import sveltePreprocess from "svelte-preprocess";
import * as path from "path";

export default defineConfig({
  plugins: [
    svelte({
      hot: !process.env.VITEST,
      preprocess: sveltePreprocess(),
    }),
  ],
  resolve: {
	    alias: {
	      "src": path.resolve('./src'),
	      "obsidian": path.resolve("./tests/mocks/obsidian.ts"),
	    },
    conditions: ["browser"],
  },
	test: {
		include: ["src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
		globals: true,
		environment: "jsdom",
		setupFiles: ["./vitest.setup.ts"],
	},
});
