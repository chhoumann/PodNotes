import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createObsidianClient, resolveObsidianEnvOptions } from "obsidian-e2e";
import { acquireVaultRunLock } from "obsidian-e2e/vitest";
import { beforeAll, expect, test } from "vitest";
import { setOffline } from "./journey/actions";
import { jsLiteral, runAllSteps } from "./runtime";
import {
	assertNoNewRuntimeErrors,
	closeRuntimeEvidence,
	collectRuntimeErrors,
	installRuntimeEvidence,
} from "./runtime-evidence";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RECORDER = /^podnotes-e2e-errors-\d+$/;
const obsidian = createObsidianClient(resolveObsidianEnvOptions({ legacyPrefix: "PODNOTES" }));

type SuiteResult = Readonly<{
	code: number | null;
	error: string;
	tests: ReadonlyArray<{ title: string; status: string; failure: string }>;
}>;

async function runFixture(fixture: string, signal: AbortSignal): Promise<SuiteResult> {
	const results = path.join(
		REPO_ROOT,
		".obsidian-e2e-artifacts",
		"harness-lifecycle",
		`${process.pid}-${fixture}.json`,
	);
	await fs.mkdir(path.dirname(results), { recursive: true });
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith("VITEST")),
	);
	const child = spawn(
		process.execPath,
		[
			path.join(REPO_ROOT, "node_modules/vitest/vitest.mjs"),
			"run",
			"--config",
			"tests/e2e/harness-fixtures/vitest.config.ts",
			"--configLoader",
			"bundle",
			"--reporter=json",
			`--outputFile.json=${results}`,
			`tests/e2e/harness-fixtures/${fixture}.fixture.ts`,
		],
		{ cwd: REPO_ROOT, env, signal, stdio: ["ignore", "ignore", "inherit"] },
	);
	const [code] = (await once(child, "close")) as [number | null];
	try {
		const report = JSON.parse(
			await fs.readFile(results, "utf8").catch((error: unknown) => {
				throw new Error(
					`The ${fixture} fixture exited with code ${code} and no report: ${String(error)}`,
				);
			}),
		);
		const [file] = report.testResults;
		return {
			code,
			error: file.message,
			tests: file.assertionResults.map(
				(result: { title: string; status: string; failureMessages: string[] }) => ({
					title: result.title,
					status: result.status,
					failure: result.failureMessages.join("\n"),
				}),
			),
		};
	} finally {
		await fs.rm(results, { force: true });
	}
}

async function withVaultLock<T>(run: () => Promise<T>): Promise<T> {
	const lock = await acquireVaultRunLock({
		vaultName: obsidian.vaultName,
		vaultPath: await obsidian.vaultPath(),
		timeoutMs: 60_000,
	});
	try {
		return await run();
	} finally {
		await lock.release();
	}
}

async function obsidianDir(): Promise<string> {
	return path.join(await obsidian.vaultPath(), ".obsidian");
}

async function readOptional(filePath: string): Promise<Buffer | null> {
	return await fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
		return null;
	});
}

async function pluginState() {
	const dir = await obsidianDir();
	return {
		config: await readOptional(path.join(dir, "community-plugins.json")),
		data: await readOptional(path.join(dir, "plugins", "podnotes", "data.json")),
		enabled: await obsidian.dev.evalJson<string[]>("[...app.plugins.enabledPlugins]"),
		recorders: (await fs.readdir(path.join(dir, "plugins"))).filter((name) =>
			RECORDER.test(name),
		),
		stored: await obsidian.dev.evalJson<string[]>(
			'Object.keys(localStorage).filter((key) => key.startsWith("podnotes-e2e-errors-"))',
		),
	};
}

function raise(message: string) {
	return obsidian.dev.evalJson(
		`window.dispatchEvent(new ErrorEvent("error", { message: ${jsLiteral(message)} })), true`,
	);
}

function journalPath(dir: string) {
	return path.join(dir, "plugins", `podnotes-e2e-errors-${process.pid}`, "errors.jsonl");
}

beforeAll(() =>
	withVaultLock(async () => {
		try {
			await installRuntimeEvidence(obsidian);
		} finally {
			await closeRuntimeEvidence(obsidian);
		}
	}),
);

test("fails the suite for an error raised after the test body and after the last test", async ({
	signal,
}) => {
	const before = await withVaultLock(pluginState);
	expect(before.recorders).toEqual([]);

	const result = await runFixture("late-errors", signal);

	expect(result.code).not.toBe(0);
	expect(result.tests).toEqual([
		expect.objectContaining({
			status: "failed",
			failure: expect.stringContaining("HARNESS_TEST_CLEANUP_SENTINEL"),
		}),
	]);
	expect(result.tests[0].failure).toContain("during this test or its cleanup");
	expect(result.tests[0].failure).not.toContain("HARNESS_SUITE_CLEANUP_SENTINEL");
	expect(result.error).toContain("HARNESS_SUITE_CLEANUP_SENTINEL");
	expect(result.error).toContain("during the suite's final cleanup");
	expect(await withVaultLock(pluginState)).toEqual(before);
}, 120_000);

test("fails only the next test for an error raised between tests", async ({ signal }) => {
	const before = await withVaultLock(pluginState);

	const result = await runFixture("between-tests", signal);

	expect(result.code).not.toBe(0);
	expect(result.tests.map(({ title, status }) => [title, status])).toEqual([
		["first", "passed"],
		["second", "failed"],
		["third", "passed"],
	]);
	expect(result.tests[1].failure).toContain("before this test started");
	expect(result.tests[1].failure).toContain("HARNESS_BETWEEN_TESTS_SENTINEL");
	expect(result.error).toBe("");
	expect(await withVaultLock(pluginState)).toEqual(before);
}, 120_000);

test("fails the test whose renderer raised an error while unloading, or could not journal one", async ({
	signal,
}) => {
	const before = await withVaultLock(pluginState);

	const result = await runFixture("renderer-shutdown", signal);

	expect(result.code).not.toBe(0);
	expect(result.tests.map(({ title, status }) => [title, status])).toEqual([
		["an error thrown while the renderer unloads for a reload", "failed"],
		["an error journal write that fails while Obsidian quits", "failed"],
		["the next test", "passed"],
	]);
	expect(result.tests[0].failure).toContain("during this test or its cleanup");
	expect(result.tests[0].failure).toContain("HARNESS_RELOAD_UNLOAD_SENTINEL");
	expect(result.tests[1].failure).toContain(
		"The error journal could not be written: Error: EACCES: permission denied",
	);
	expect(result.error).toBe("");
	expect(await withVaultLock(pluginState)).toEqual(before);
}, 180_000);

test("accepts only the named error message, and only where it is collected", async () => {
	const dir = await obsidianDir();
	const ignored = "HARNESS_IGNORED_SENTINEL";
	await withVaultLock(async () => {
		await installRuntimeEvidence(obsidian);
		try {
			await raise(ignored);
			await raise(`${ignored} with more`);
			await collectRuntimeErrors(obsidian, ignored);
			const kept = await assertNoNewRuntimeErrors(obsidian).then(() => "", String);
			expect(kept).toContain(`window {"source":"error","message":"${ignored} with more"}`);
			expect(kept.replaceAll(`${ignored} with more`, "")).not.toContain(ignored);

			await raise(ignored);
			await expect(assertNoNewRuntimeErrors(obsidian)).rejects.toThrow(ignored);

			await fs.chmod(journalPath(dir), 0o444);
			try {
				await raise(ignored);
				await collectRuntimeErrors(obsidian, ignored);
			} finally {
				await fs.chmod(journalPath(dir), 0o644);
			}
			await expect(assertNoNewRuntimeErrors(obsidian)).rejects.toThrow(
				"The error journal could not be written",
			);
		} finally {
			await closeRuntimeEvidence(obsidian);
		}
	});
}, 60_000);

test("removes installs an interrupted run left before their manifest was complete", async () => {
	const plugins = path.join(await obsidianDir(), "plugins");
	const manifest = (id: string) =>
		`{"id":"${id}","name":"PodNotes E2E error recorder","version":"1.0.0","minAppVersion":"1.13.0","description":"Journal uncaught renderer errors for the PodNotes e2e suite.","author":"PodNotes tests"}`;
	const interrupted: Record<string, Record<string, string>> = {
		"podnotes-e2e-errors-2": { "errors.jsonl": "", "manifest.json": "" },
		"podnotes-e2e-errors-3": {
			"errors.jsonl": "",
			"main.js": "",
			"manifest.json": manifest("podnotes-e2e-errors-3").slice(0, 60),
		},
		"podnotes-e2e-errors-4": {
			"errors.jsonl": "",
			"main.js": "",
			"manifest.json.tmp": manifest("podnotes-e2e-errors-4").slice(0, 60),
		},
		"podnotes-e2e-errors-5": {},
	};
	await withVaultLock(async () => {
		const before = await pluginState();
		try {
			for (const [id, files] of Object.entries(interrupted)) {
				await fs.mkdir(path.join(plugins, id));
				for (const [name, text] of Object.entries(files))
					await fs.writeFile(path.join(plugins, id, name), text);
			}
			try {
				await installRuntimeEvidence(obsidian);
			} finally {
				await closeRuntimeEvidence(obsidian);
			}
			expect(await pluginState()).toEqual(before);
		} finally {
			await runAllSteps(
				...Object.keys(interrupted).map(
					(id) => () => fs.rm(path.join(plugins, id), { recursive: true, force: true }),
				),
			);
		}
	});
}, 60_000);

test.each([
	["another plugin's manifest", JSON.stringify({ id: "other", name: "Other plugin" })],
	[
		"a manifest that is not the start of a recorder's",
		'{"id":"podnotes-e2e-errors-2","name":"Other',
	],
])(
	"refuses to remove a reserved folder holding %s",
	async (_, text) => {
		const folder = path.join(await obsidianDir(), "plugins", "podnotes-e2e-errors-2");
		await withVaultLock(async () => {
			const before = await pluginState();
			try {
				await fs.mkdir(folder);
				await fs.writeFile(path.join(folder, "manifest.json"), text);
				try {
					await expect(installRuntimeEvidence(obsidian)).rejects.toThrow(
						`Refusing to remove ${folder}: it is not a PodNotes e2e error recorder.`,
					);
				} finally {
					await closeRuntimeEvidence(obsidian);
				}
				expect(await fs.readFile(path.join(folder, "manifest.json"), "utf8")).toBe(text);
				expect({ ...(await pluginState()), recorders: [] }).toEqual(before);
			} finally {
				await fs.rm(folder, { recursive: true, force: true });
			}
		});
	},
	60_000,
);

test.for([true, false])(
	"recovers a stale recorder, a collapsed sidebar and an offline renderer with PodNotes initially enabled=%s",
	{ timeout: 120_000 },
	async (initiallyEnabled, { signal }) => {
		const dir = await obsidianDir();
		const stale = "podnotes-e2e-errors-1";
		const unrelated = path.join(dir, "plugins", "podnotes-e2e-errors-notes");
		let createdUnrelated = false;
		const workspacePath = path.join(dir, "workspace.json");
		const { before, original } = await withVaultLock(async () => ({
			before: await pluginState(),
			original: await fs.readFile(workspacePath),
		}));
		try {
			const seeded = await withVaultLock(async () => {
				await fs.mkdir(path.join(dir, "plugins", stale));
				await fs.writeFile(
					path.join(dir, "plugins", stale, "manifest.json"),
					JSON.stringify({
						id: stale,
						name: "PodNotes E2E error recorder",
						version: "1.0.0",
						minAppVersion: "1.13.0",
						description: "",
						author: "PodNotes tests",
					}),
				);
				await fs.writeFile(
					path.join(dir, "plugins", stale, "main.js"),
					'module.exports = class extends require("obsidian").Plugin {};',
				);
				await fs.mkdir(unrelated);
				createdUnrelated = true;
				await obsidian.dev.evalJsonAsync(`(async () => {
				if (!${jsLiteral(initiallyEnabled)}) await app.plugins.disablePluginAndSave("podnotes");
				await app.plugins.loadManifests();
				await app.plugins.enablePlugin(${jsLiteral(stale)});
				app.plugins.enabledPlugins = new Set([${jsLiteral(stale)}, ...app.plugins.enabledPlugins]);
				app.plugins.requestSaveConfig.cancel();
				await app.plugins.saveConfig();
				const layout = app.workspace.getLayout();
				layout.left.collapsed = true;
				layout.left.width = -200;
				await app.workspace.changeLayout(layout);
				app.workspace.requestSaveLayout.cancel();
				await app.workspace.saveLayout();
				await app.vault.adapter.promise;
				return true;
			})()`);
				await setOffline(obsidian, true);
				return {
					config: await fs.readFile(path.join(dir, "community-plugins.json"), "utf8"),
					workspace: await fs.readFile(workspacePath),
				};
			});
			const result = await runFixture("reused-vault", signal);

			expect(result).toMatchObject({ code: 0, error: "" });
			expect(result.tests.map(({ status }) => status)).toEqual(["passed"]);
			await withVaultLock(async () => {
				const after = await pluginState();
				const expected = before.enabled.filter(
					(id) => initiallyEnabled || id !== "podnotes",
				);
				expect(after.enabled).toEqual(expected);
				expect(after.recorders).toEqual([]);
				expect(JSON.parse(String(after.config))).toEqual(
					JSON.parse(seeded.config).filter((id: string) => id !== stale),
				);
				await expect(fs.stat(unrelated)).resolves.toBeTruthy();
				expect(await fs.readFile(workspacePath)).toEqual(seeded.workspace);
				expect(
					await obsidian.dev.evalJson<boolean>("app.workspace.leftSplit.collapsed"),
				).toBe(true);
			});
		} finally {
			await withVaultLock(() =>
				runAllSteps(
					() => setOffline(obsidian, false),
					() =>
						obsidian.dev.evalJsonAsync(`(async () => {
						await app.plugins.disablePlugin(${jsLiteral(stale)});
						if (${jsLiteral(before.enabled.includes("podnotes"))}) await app.plugins.enablePlugin("podnotes");
						app.plugins.enabledPlugins = new Set(${jsLiteral(before.enabled)});
						app.plugins.requestSaveConfig.cancel();
						await app.vault.adapter.promise;
						return true;
					})()`),
					() =>
						obsidian.dev.evalJsonAsync(`(async () => {
						await app.workspace.changeLayout(${jsLiteral(JSON.parse(original.toString("utf8")))});
						app.workspace.requestSaveLayout.cancel();
						await app.workspace.saveLayout();
						app.workspace.requestSaveLayout.cancel();
						await app.vault.adapter.promise;
						return true;
					})()`),
					() => fs.rm(path.join(dir, "plugins", stale), { recursive: true, force: true }),
					async () => {
						if (createdUnrelated)
							await fs.rm(unrelated, { recursive: true, force: true });
					},
					async () => {
						const config = path.join(dir, "community-plugins.json");
						if (before.config === null) await fs.rm(config, { force: true });
						else await fs.writeFile(config, before.config);
					},
					() => fs.writeFile(workspacePath, original),
					() =>
						obsidian.dev.evalJsonAsync(
							"(async () => { await app.plugins.loadManifests(); return true; })()",
						),
				),
			);
		}
	},
);
