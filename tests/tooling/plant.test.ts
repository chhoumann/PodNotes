import { spawn, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const plant = join(root, "scripts/plant.mjs");
const vitest = join(root, "node_modules/vitest/vitest.mjs");
const source = 'export const extension = (url) => url.split(/[?#]/)[0].split(".").pop();\n';
const files: Record<string, string> = {
	"package.json": JSON.stringify({ scripts: { typecheck: "node -e 0" } }),
	"vitest.config.mjs": 'export default { test: { include: ["src/**/*.test.mjs"] } };\n',
	"src/extension.mjs": source,
	"src/extension.test.mjs": [
		'import { expect, test } from "vitest";',
		'import { extension } from "./extension.mjs";',
		'test("reads the extension", () => expect(extension("a/b.mp3")).toBe("mp3"));',
		'test("reads the extension with params", () => expect(extension("b.mp3?x=1")).toBe("mp3"));',
		"",
	].join("\n"),
};
// CI and FORCE_COLOR turn Vitest's colors on, which the FAIL match must survive.
const env: NodeJS.ProcessEnv = { ...process.env, CI: "true", FORCE_COLOR: "1" };
delete env.NO_COLOR;

function withWorkspace(run: (workspace: string) => void | Promise<void>) {
	return async () => {
		const workspace = realpathSync(mkdtempSync(join(tmpdir(), "podnotes-plant-test-")));
		try {
			symlinkSync(join(root, "node_modules"), join(workspace, "node_modules"), "junction");
			for (const [name, text] of Object.entries(files)) {
				mkdirSync(dirname(join(workspace, name)), { recursive: true });
				writeFileSync(join(workspace, name), text);
			}
			await run(workspace);
		} finally {
			rmSync(workspace, { recursive: true, force: true });
		}
	};
}

function runPlant(workspace: string, args: string[]) {
	const result = spawnSync(process.execPath, [plant, ...args], {
		cwd: workspace,
		encoding: "utf8",
		env,
		timeout: 60_000,
	});
	expect(result.error).toBeUndefined();
	return { status: result.status, output: result.stdout + result.stderr };
}

const sourceOf = (workspace: string) => readFileSync(join(workspace, "src/extension.mjs"), "utf8");

describe("npm run plant", () => {
	it(
		"passes when the named test fails on the plant, and restores the file",
		withWorkspace((workspace) => {
			const { status, output } = runPlant(workspace, [
				"reads the extension",
				"src/extension.mjs",
				".pop()",
				".shift()",
			]);
			expect(status, output).toBe(0);
			expect(output).toContain(
				"Caught by:\nFAIL  src/extension.test.mjs > reads the extension\n",
			);
			expect(sourceOf(workspace)).toBe(source);
		}),
		60_000,
	);

	it(
		"fails when only a test whose name extends the named one fails",
		withWorkspace((workspace) => {
			const { status, output } = runPlant(workspace, [
				"reads the extension",
				"src/extension.mjs",
				"/[?#]/",
				"/#/",
				"--",
				process.execPath,
				vitest,
				"run",
			]);
			expect(status, output).toBe(1);
			expect(output).toContain("Not caught");
			expect(sourceOf(workspace)).toBe(source);
		}),
		60_000,
	);

	it(
		"fails when the named test already fails without the plant",
		withWorkspace((workspace) => {
			writeFileSync(join(workspace, "src/extension.mjs"), source.replace("pop", "shift"));
			const { status, output } = runPlant(workspace, [
				"reads the extension",
				"src/extension.mjs",
				".shift()",
				".shift()",
			]);
			expect(status, output).toBe(1);
			expect(output).toContain("fails without the plant");
		}),
		60_000,
	);

	it(
		"refuses a search that does not match exactly once",
		withWorkspace((workspace) => {
			const { status, output } = runPlant(workspace, [
				"reads the extension",
				"src/extension.mjs",
				"split",
				"cut",
			]);
			expect(status, output).toBe(1);
			expect(output).toContain("matched 2 times");
			expect(sourceOf(workspace)).toBe(source);
		}),
	);

	it(
		"applies every edit to a file named two ways, and restores it",
		withWorkspace((workspace) => {
			// Only the two renames together keep the code working.
			const { status, output } = runPlant(workspace, [
				"reads the extension",
				"src/extension.mjs",
				"(url)",
				"(link)",
				join(workspace, "src/extension.mjs"),
				"url.split",
				"link.split",
			]);
			expect(status, output).toBe(1);
			expect(output).toContain("Not caught");
			expect(sourceOf(workspace)).toBe(source);
		}),
		60_000,
	);

	it.skipIf(process.platform === "win32")(
		"restores the file when it is stopped mid-run",
		withWorkspace(async (workspace) => {
			// Hangs while the plant is in.
			const hang =
				'require("fs").readFileSync("src/extension.mjs", "utf8").includes("shift") && setTimeout(() => {}, 30_000)';
			const child = spawn(
				process.execPath,
				[
					plant,
					"reads the extension",
					"src/extension.mjs",
					".pop()",
					".shift()",
					"--",
					process.execPath,
					"-e",
					hang,
				],
				{ cwd: workspace, env },
			);
			let output = "";
			child.stdout.on("data", (chunk) => (output += chunk));
			child.stderr.on("data", (chunk) => (output += chunk));
			const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
			await expect.poll(() => sourceOf(workspace), { timeout: 30_000 }).not.toBe(source);
			child.kill("SIGTERM");
			expect(await exited, output).toBe(143);
			expect(sourceOf(workspace)).toBe(source);
		}),
		90_000,
	);
});
