import { builtinModules } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { createBuildArtifactPlugin } from "./scripts/build-artifacts.ts";
import { stripCssComments } from "./scripts/css-comments.ts";
import { svelteWithoutHydration } from "./scripts/svelte-without-hydration.ts";
import { syntaxFloor } from "./scripts/syntax-floor.ts";

// Obsidian's Android app sets no WebView minimum and its own code is ES2020, and its
// iOS app still supports Safari 15, which mis-scopes some class fields. syntaxFloor()
// enforces this target on the final bundle.
const target = "es2020";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

const externalDeps = [
	"obsidian",
	"electron",
	"@codemirror/autocomplete",
	"@codemirror/closebrackets",
	"@codemirror/collab",
	"@codemirror/commands",
	"@codemirror/comment",
	"@codemirror/fold",
	"@codemirror/gutter",
	"@codemirror/highlight",
	"@codemirror/history",
	"@codemirror/language",
	"@codemirror/lint",
	"@codemirror/matchbrackets",
	"@codemirror/panel",
	"@codemirror/rangeset",
	"@codemirror/rectangular-selection",
	"@codemirror/search",
	"@codemirror/state",
	"@codemirror/stream-parser",
	"@codemirror/text",
	"@codemirror/tooltip",
	"@codemirror/view",
	"@lezer/common",
	"@lezer/highlight",
	"@lezer/lr",
];

const builtinExternals = builtinModules.filter((moduleName) => !moduleName.startsWith("_"));

const external = [
	...externalDeps,
	...builtinExternals,
	...builtinExternals.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig(({ mode }) => {
	const isProd = mode === "production";
	const outDir = path.resolve(rootDir, "build");

	return {
		plugins: [
			svelte({
				// Svelte copies style comments verbatim into the CSS it injects from main.js.
				preprocess: { style: ({ content }) => ({ code: stripCssComments(content) }) },
				compilerOptions: {
					css: "injected",
					discloseVersion: false,
					// Svelte skips a style whose id is already in the document, and Obsidian
					// updates a plugin without reloading the window, so the id follows the CSS.
					cssHash: ({ hash, css }) => `pn-${hash(css)}`,
				},
			}),
			// Development builds keep their source maps, which this transform does not update.
			isProd && svelteWithoutHydration(),
			syntaxFloor(),
			createBuildArtifactPlugin({ isProduction: isProd, outDir, rootDir }),
		],
		resolve: {
			alias: {
				src: path.resolve(rootDir, "src"),
			},
			// Setting conditions replaces Vite's defaults, so the dev/prod condition
			// must be listed or esm-env reads process.env.NODE_ENV at runtime instead.
			conditions: ["browser", "development|production"],
		},
		build: {
			lib: {
				entry: path.resolve(rootDir, "src/main.ts"),
				formats: ["cjs"],
				fileName: () => "main.js",
			},
			target,
			outDir,
			emptyOutDir: true,
			sourcemap: !isProd,
			// Terser inlines single-use functions and variables that Oxc keeps. It runs
			// before the Oxc minifier below, which mangles names and drops console calls.
			minify: isProd ? "terser" : false,
			// Reading a Svelte state property subscribes to it, so a read is not pure.
			terserOptions: { compress: { pure_getters: false, passes: 2 }, mangle: false },
			rollupOptions: {
				external,
				output: {
					entryFileNames: "main.js",
					codeSplitting: false,
					exports: "auto",
					// Nothing bundles main.js again, so pure annotations are dead bytes. Vite drops
					// legal comments once build.minify is set, so keep the license notices explicitly.
					comments: { annotation: false, legal: true },
					// Vite 8 dropped the esbuild transform (and with it
					// esbuild.drop), so prod minification and console
					// stripping both move to rolldown's oxc minifier.
					minify: isProd
						? { compress: { target, dropConsole: true }, mangle: true, codegen: true }
						: false,
				},
			},
		},
	};
});
