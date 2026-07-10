import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_SETTINGS } from "src/constants";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_PODNOTES_DATA,
	parseArgs,
	provisionVault,
	resolveProvisionOptions,
	toShellExports,
} from "./provision-obsidian-e2e-vault.mjs";

const tempRoots: string[] = [];

async function makeTempDir(name: string) {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${name}-`));
	tempRoots.push(dir);
	return dir;
}

// PodNotes ships only manifest.json + main.js (CSS is injected into the bundle),
// so a seeded worktree never has a styles.css to link.
async function seedWorktree(dir: string, label: string) {
	await fs.mkdir(dir, { recursive: true });
	await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ id: "podnotes" }));
	await fs.writeFile(path.join(dir, "main.js"), `console.log(${JSON.stringify(label)});\n`);
}

async function readLinkedTarget(filePath: string) {
	return path.resolve(path.dirname(filePath), await fs.readlink(filePath));
}

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe("provision-obsidian-e2e-vault", () => {
	it("parses vault and root options", () => {
		const options = resolveProvisionOptions(
			parseArgs(["--vault", "podnotes-a", "--root", "vaults"]),
			"/tmp/podnotes-repo",
		);

		expect(options.vaultName).toBe("podnotes-a");
		expect(options.rootPath).toBe("/tmp/podnotes-repo/vaults");
		expect(options.vaultPath).toBe("/tmp/podnotes-repo/vaults/podnotes-a");
	});

	it("seeds schema v2 data that mirrors the real DEFAULT_SETTINGS", () => {
		// JSON cannot represent currentEpisode: undefined, so compare the
		// serialized forms - this is exactly what lands in the vault's data.json
		// and it fails if a new setting is added to src/constants.ts without
		// updating DEFAULT_PODNOTES_DATA.
		expect(JSON.parse(JSON.stringify(DEFAULT_PODNOTES_DATA))).toEqual({
			schemaVersion: 2,
			...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
		});
	});

	it("defaults the vault name to podnotes-<worktree>", () => {
		const options = resolveProvisionOptions(
			parseArgs([]),
			"/tmp/repos/devx-worktree-vault-isolation",
		);

		expect(options.vaultName).toBe("podnotes-devx-worktree-vault-isolation");
	});

	it("anchors the default vault root to the worktree, not cwd", () => {
		// --worktree elsewhere without --root must keep the vault inside that
		// checkout (worktree-local isolation), not the caller's cwd.
		const options = resolveProvisionOptions(
			parseArgs(["--worktree", "/tmp/other/checkout"]),
			"/tmp/caller-cwd",
		);

		expect(options.rootPath).toBe("/tmp/other/checkout/.obsidian-e2e-vaults");
		expect(options.vaultPath).toBe(
			"/tmp/other/checkout/.obsidian-e2e-vaults/podnotes-checkout",
		);
	});

	it("creates an Obsidian vault with PodNotes symlinked from a worktree", async () => {
		const root = await makeTempDir("podnotes-e2e-root");
		const worktree = await makeTempDir("podnotes-worktree-a");
		await seedWorktree(worktree, "a");

		const options = resolveProvisionOptions({
			root,
			vault: "podnotes-a",
			worktree,
		});

		const result = await provisionVault(options);
		const pluginPath = path.join(result.vaultPath, ".obsidian", "plugins", "podnotes");

		await expect(
			fs.readFile(path.join(result.vaultPath, ".obsidian", "community-plugins.json"), "utf8"),
		).resolves.toBe('[\n\t"podnotes"\n]\n');
		await expect(readLinkedTarget(path.join(pluginPath, "main.js"))).resolves.toBe(
			path.join(worktree, "main.js"),
		);
		await expect(readLinkedTarget(path.join(pluginPath, "manifest.json"))).resolves.toBe(
			path.join(worktree, "manifest.json"),
		);
		// CSS is injected into main.js, so no styles.css link is created.
		await expect(fs.lstat(path.join(pluginPath, "styles.css"))).rejects.toMatchObject({
			code: "ENOENT",
		});
		const seededData = JSON.parse(
			await fs.readFile(path.join(pluginPath, "data.json"), "utf8"),
		);
		expect(seededData).toEqual(DEFAULT_PODNOTES_DATA);
		expect(toShellExports(result)).toContain("PODNOTES_E2E_VAULT='podnotes-a'");
		expect(toShellExports(result)).toContain(`PODNOTES_E2E_VAULT_PATH='${result.vaultPath}'`);
	});

	it("keeps separately provisioned worktrees isolated", async () => {
		const root = await makeTempDir("podnotes-e2e-root");
		const worktreeA = await makeTempDir("podnotes-worktree-a");
		const worktreeB = await makeTempDir("podnotes-worktree-b");
		await seedWorktree(worktreeA, "a");
		await seedWorktree(worktreeB, "b");

		const resultA = await provisionVault(
			resolveProvisionOptions({
				root,
				vault: "podnotes-a",
				worktree: worktreeA,
			}),
		);
		const resultB = await provisionVault(
			resolveProvisionOptions({
				root,
				vault: "podnotes-b",
				worktree: worktreeB,
			}),
		);

		const mainA = path.join(resultA.vaultPath, ".obsidian", "plugins", "podnotes", "main.js");
		const mainB = path.join(resultB.vaultPath, ".obsidian", "plugins", "podnotes", "main.js");

		await expect(readLinkedTarget(mainA)).resolves.toBe(path.join(worktreeA, "main.js"));
		await expect(readLinkedTarget(mainB)).resolves.toBe(path.join(worktreeB, "main.js"));
		expect(resultA.vaultPath).not.toBe(resultB.vaultPath);
	});

	it("does not overwrite existing plugin data", async () => {
		const root = await makeTempDir("podnotes-e2e-root");
		const worktree = await makeTempDir("podnotes-worktree");
		const seedData = path.join(await makeTempDir("podnotes-seed"), "data.json");
		await seedWorktree(worktree, "a");
		await fs.writeFile(seedData, '{"podNotes":{"seed":true}}\n');

		const options = resolveProvisionOptions({
			data: seedData,
			root,
			vault: "podnotes-data",
			worktree,
		});

		const result = await provisionVault(options);
		const dataPath = path.join(result.pluginPath, "data.json");
		// First provision with --data copies the seed verbatim (not DEFAULT_PODNOTES_DATA).
		await expect(fs.readFile(dataPath, "utf8")).resolves.toBe('{"podNotes":{"seed":true}}\n');

		await fs.writeFile(dataPath, '{"podNotes":{"kept":true}}\n');
		await provisionVault(options);

		await expect(fs.readFile(dataPath, "utf8")).resolves.toBe('{"podNotes":{"kept":true}}\n');
	});

	it("fails fast when the worktree has no built plugin artifacts", async () => {
		const root = await makeTempDir("podnotes-e2e-root");
		const worktree = await makeTempDir("podnotes-worktree-empty");

		await expect(
			provisionVault(resolveProvisionOptions({ root, vault: "podnotes-empty", worktree })),
		).rejects.toThrow(/missing manifest\.json, main\.js/);
	});
});
