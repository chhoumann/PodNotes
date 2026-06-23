import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importX from "eslint-plugin-import-x";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";

const sharedGlobals = {
	...globals.browser,
	...globals.node,
	...globals.es2021,
	app: "readonly",
	// Obsidian exposes these globals (the active, possibly popped-out window /
	// document); plugin code prefers them over bare window/document.
	activeWindow: "readonly",
	activeDocument: "readonly",
};

const vitestGlobals = {
	afterAll: "readonly",
	afterEach: "readonly",
	beforeAll: "readonly",
	beforeEach: "readonly",
	describe: "readonly",
	expect: "readonly",
	it: "readonly",
	test: "readonly",
	vi: "readonly",
	vitest: "readonly",
};

const languageOptions = {
	parser: tsParser,
	parserOptions: {
		sourceType: "module",
	},
	globals: sharedGlobals,
};

const plugins = {
	"@typescript-eslint": tsPlugin,
	import: importX,
};

const rules = {
	...js.configs.recommended.rules,
	...tsPlugin.configs.recommended.rules,
	"no-unused-vars": "off",
	"no-prototype-builtins": "off",
	"import/no-duplicates": "error",
	"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
	"@typescript-eslint/ban-ts-comment": "off",
	"@typescript-eslint/consistent-type-imports": [
		"error",
		{
			prefer: "type-imports",
			disallowTypeAnnotations: false,
			fixStyle: "inline-type-imports",
		},
	],
	"@typescript-eslint/no-empty-function": "off",
};

// Obsidian developer-policy / guideline rules (from eslint-plugin-obsidianmd),
// enforced on the production plugin source so the fixes made for the community
// plugin review can't silently regress. Scoped to non-test source: the tests
// legitimately stub the global `app`, and these are AST-based rules so they need
// no type information. The remaining review findings backed by type-checked
// rules (no-floating-promises, no-misused-promises, no-duplicate-type-constituents)
// are kept correct via the existing checks/tests rather than enabling project-wide
// type-aware linting here.
const obsidianGuidelineRules = {
	"obsidianmd/no-static-styles-assignment": "error",
	"obsidianmd/prefer-window-timers": "error",
	"obsidianmd/prefer-active-doc": "error",
	"obsidianmd/detach-leaves": "error",
	"obsidianmd/no-global-this": "error",
	"obsidianmd/settings-tab/no-manual-html-headings": "error",
	"obsidianmd/commands/no-plugin-name-in-command-name": "error",
	"no-restricted-globals": [
		"error",
		{
			name: "app",
			message:
				"Avoid the global app object. Use the reference provided by your plugin instance (this.app, or get(plugin).app for module-level code).",
		},
		{
			name: "fetch",
			message:
				"Use Obsidian's requestUrl instead of fetch for network requests.",
		},
		{
			name: "localStorage",
			message:
				"Use App#saveLocalStorage / App#loadLocalStorage for vault-scoped storage instead of the global localStorage.",
		},
	],
};

export default [
	{
		ignores: ["node_modules", "build", "npm", "main.js"],
	},
	{
		files: ["**/*.{ts,cts,mts}"],
		languageOptions,
		plugins,
		rules,
	},
	{
		files: ["src/**/*.{ts,cts,mts}"],
		ignores: ["src/**/*.{test,spec}.{ts,cts,mts}"],
		plugins: { obsidianmd },
		rules: obsidianGuidelineRules,
	},
	{
		files: ["**/*.{test,spec}.{ts,cts,mts}"],
		languageOptions: {
			...languageOptions,
			globals: {
				...sharedGlobals,
				...vitestGlobals,
			},
		},
		plugins,
		rules,
	},
];
