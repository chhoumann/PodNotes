import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

type Files = Record<string, string>;

const root = process.cwd();

// File names are lowercase because svelte-check lowercases some paths on macOS.
const cleanFiles: Files = {
	"src/main.ts": 'export { default as Probe } from "./probe.svelte";\n',
	"src/probe.svelte":
		'<script lang="ts">\n\tconst count: number = 1;\n</script>\n\n<p>{count}</p>\n',
	"tests/probe.ts": "export const count: number = 1;\n",
};

const defects: Record<string, { files: Files; diagnostic: string }> = {
	"a compiler warning": {
		files: { "src/probe.svelte": '<img src="probe.png" />\n' },
		diagnostic: "probe.svelte Warn a11y_missing_attribute",
	},
	"a type error in the test project": {
		files: { "tests/probe.ts": 'export const count: number = "1";\n' },
		diagnostic: "probe.ts Error Type 'string' is not assignable to type 'number'.",
	},
	"an unimported component in the test project that does not parse": {
		files: { "tests/broken.svelte": "<div>\n" },
		diagnostic: "broken.svelte Error element_unclosed",
	},
	"a .ts import of a deleted component": {
		files: { "src/main.ts": 'export { default as Gone } from "./gone.svelte";\n' },
		diagnostic:
			"main.ts Error Cannot find module './gone.svelte' or its corresponding type declarations.",
	},
};

// svelte-check passes when its tsconfig matches no files, so lint:tsconfig must fail first.
const unmatchedTsconfig = JSON.stringify({
	extends: "./tsconfig.base.json",
	include: ["missing/**/*.ts"],
});
const emptyProjects: Record<string, { files: Files; output: RegExp }> = {
	"source tsconfig": {
		files: { "tsconfig.json": unmatchedTsconfig },
		output: /error TS18003: No inputs were found in config file '[^']*\btsconfig\.json'/,
	},
	"test tsconfig": {
		files: { "tsconfig.test.json": unmatchedTsconfig },
		output: /error TS18003: No inputs were found in config file '[^']*\btsconfig\.test\.json'/,
	},
};

function withWorkspace(files: Files, run: (workspace: string) => void) {
	const workspace = realpathSync(mkdtempSync(join(tmpdir(), "podnotes-svelte-check-")));
	try {
		symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), "junction");
		const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
		const project: Files = { "package.json": JSON.stringify({ scripts }) };
		for (const name of ["tsconfig.base.json", "tsconfig.json", "tsconfig.test.json"]) {
			project[name] = readFileSync(join(root, name), "utf8");
		}
		for (const [name, text] of Object.entries({ ...project, ...cleanFiles, ...files })) {
			mkdirSync(dirname(join(workspace, name)), { recursive: true });
			writeFileSync(join(workspace, name), text);
		}
		run(workspace);
	} finally {
		rmSync(workspace, { recursive: true, force: true });
	}
}

function runCheck(workspace: string, env: NodeJS.ProcessEnv = {}) {
	const result = spawnSync("npm", ["run", "check:a11y"], {
		cwd: workspace,
		encoding: "utf8",
		// svelte-check prints machine output under Claude Code, and colors under CI.
		env: { ...process.env, CLAUDECODE: "", NO_COLOR: "1", ...env },
		shell: process.platform === "win32",
		timeout: 60_000,
	});
	expect(result.error).toBeUndefined();
	return { status: result.status, output: result.stdout + result.stderr };
}

// TypeScript diagnostics print no code, so their message stands in for it.
function diagnostics(output: string): string[] {
	const lines = output.split(/\r?\n/);
	return lines.flatMap((line, index) => {
		const path = /^(.+):\d+:\d+$/.exec(line)?.[1];
		const [, severity, message] =
			/^(Error|Warn): (.*?)(?: \(ts\))?$/.exec(lines[index + 1] ?? "") ?? [];
		if (!path || !severity) return [];
		const code = /^https:\/\/svelte\.dev\/e\/(\w+) /.exec(lines[index + 2] ?? "")?.[1];
		return [`${basename(path)} ${severity} ${code ?? message}`];
	});
}

function compilerFault(workspace: string, packageJson: string | null): NodeJS.ProcessEnv {
	const hook = join(workspace, ".fault/hook.mjs");
	mkdirSync(dirname(hook), { recursive: true });
	writeFileSync(
		hook,
		[
			'import { registerHooks } from "node:module";',
			'import { basename } from "node:path";',
			`const packageJson = ${JSON.stringify(packageJson && pathToFileURL(packageJson).href)};`,
			'if (basename(process.argv[1] ?? "") === "svelte-check") registerHooks({ resolve(specifier, context, next) {',
			'\tif (!specifier.startsWith("@typescript/typescript-")) return next(specifier, context);',
			"\tif (!packageJson) throw new Error(`Cannot find package ${specifier}`);",
			"\treturn { url: packageJson, shortCircuit: true };",
			"} });",
		].join("\n"),
	);
	const preload = `--import ${pathToFileURL(hook).href}`;
	return { NODE_OPTIONS: [process.env.NODE_OPTIONS, preload].filter(Boolean).join(" ") };
}

describe("npm run check:a11y", () => {
	it("passes a clean tree", () => {
		withWorkspace({}, (workspace) => {
			const { status, output } = runCheck(workspace);
			expect(status, output).toBe(0);
		});
	}, 90_000);

	it.each(Object.entries(defects))(
		"fails on %s",
		(_, { files, diagnostic }) => {
			withWorkspace(files, (workspace) => {
				const { status, output } = runCheck(workspace);
				expect(status, output).toBe(1);
				expect(diagnostics(output)).toEqual([diagnostic]);
			});
		},
		90_000,
	);

	// tsc exits 2 when it reports errors, and npm passes that code through.
	it.each(Object.entries(emptyProjects))(
		"fails when the %s matches no files",
		(_, { files, output }) => {
			withWorkspace(files, (workspace) => {
				const result = runCheck(workspace);
				expect(result.status, result.output).toBe(2);
				expect(result.output).toMatch(output);
			});
		},
		90_000,
	);

	it("fails when the native compiler cannot be resolved", () => {
		withWorkspace({}, (workspace) => {
			const { status, output } = runCheck(workspace, compilerFault(workspace, null));
			expect(status, output).toBe(1);
			expect(output).toContain(
				`Unable to resolve @typescript/typescript-${process.platform}-${process.arch}.`,
			);
			expect(output).toContain("svelte-check failed");
		});
	}, 90_000);

	// A shell script cannot stand in for the Windows compiler executable.
	it.skipIf(process.platform === "win32")(
		"fails when the native compiler is killed",
		() => {
			withWorkspace({}, (workspace) => {
				const compiler = join(workspace, ".fault/compiler");
				mkdirSync(join(compiler, "lib"), { recursive: true });
				writeFileSync(join(compiler, "package.json"), "{}");
				writeFileSync(
					join(compiler, "lib/tsc"),
					'#!/bin/sh\nps -o args= -p $PPID > "$0.parent"\nkill -KILL $$\n',
				);
				chmodSync(join(compiler, "lib/tsc"), 0o755);
				const { status, output } = runCheck(
					workspace,
					compilerFault(workspace, join(compiler, "package.json")),
				);
				expect(status, output).toBe(1);
				expect(readFileSync(join(compiler, "lib/tsc.parent"), "utf8")).toContain(
					"svelte-check",
				);
				expect(output).not.toContain("svelte-check found");
			});
		},
		90_000,
	);
});
