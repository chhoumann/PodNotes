import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import globals from "globals";

const sharedGlobals = {
	...globals.browser,
	...globals.node,
	...globals.es2021,
	app: "readonly",
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
	import: importPlugin,
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

export default [
	{
		ignores: ["node_modules", "build", "npm"],
	},
	{
		files: ["**/*.{ts,cts,mts}"],
		languageOptions,
		plugins,
		rules,
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
