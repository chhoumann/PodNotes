import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	assertReleaseVersion,
	createArtifactManifest,
	materializeVersionFiles,
	validateCurrentVersionFiles,
	validateReleasePr,
	validateVersionFiles,
} from "./release-contract.mjs";

const tempRoots: string[] = [];
const BASE_SHA = "a".repeat(40);

async function makeTempRoot(name: string) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), `podnotes-${name}-`));
	tempRoots.push(root);
	return root;
}

async function writeJson(filePath: string, value: unknown) {
	await fs.writeFile(filePath, `${JSON.stringify(value, null, "\t")}\n`);
}

async function writeVersionFixture(root: string, version = "2.17.3") {
	await fs.mkdir(root, { recursive: true });
	await writeJson(path.join(root, "package.json"), {
		name: "podnotes",
		scripts: { test: "vitest" },
		version,
	});
	await writeJson(path.join(root, "package-lock.json"), {
		lockfileVersion: 3,
		name: "podnotes",
		packages: { "": { name: "podnotes", version } },
		version,
	});
	await writeJson(path.join(root, "manifest.json"), {
		id: "podnotes",
		minAppVersion: "1.0.0",
		version,
	});
	await writeJson(path.join(root, "versions.json"), { [version]: "1.0.0" });
}

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })),
	);
});

describe("release version contract", () => {
	it("validates synchronized current version metadata", async () => {
		const root = await makeTempRoot("release-current");
		await writeVersionFixture(root);
		expect(validateCurrentVersionFiles(root)).toEqual({
			minAppVersion: "1.0.0",
			version: "2.17.3",
		});

		await writeJson(path.join(root, "versions.json"), { "2.17.3": "0.9.0" });
		expect(() => validateCurrentVersionFiles(root)).toThrow("does not record");
		expect(validateCurrentVersionFiles(root, { allowPendingMinAppVersion: true })).toEqual({
			minAppVersion: "1.0.0",
			version: "2.17.3",
		});
	});

	it("accepts stable semantic versions only", () => {
		expect(assertReleaseVersion("2.17.4")).toBe("2.17.4");
		for (const value of ["v2.17.4", "2.17", "02.17.4", "2.17.4-beta.1", "../2.17.4"]) {
			expect(() => assertReleaseVersion(value)).toThrow("Invalid release version");
		}
	});

	it("rejects invalid or lowered pending compatibility floors", async () => {
		const root = await makeTempRoot("release-invalid-pending-min-app");
		await writeVersionFixture(root);
		const manifestPath = path.join(root, "manifest.json");
		const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

		manifest.minAppVersion = "0.9.0";
		await writeJson(manifestPath, manifest);
		expect(() =>
			validateCurrentVersionFiles(root, { allowPendingMinAppVersion: true }),
		).toThrow("must increase from the released compatibility floor");

		manifest.minAppVersion = "latest";
		await writeJson(manifestPath, manifest);
		expect(() =>
			validateCurrentVersionFiles(root, { allowPendingMinAppVersion: true }),
		).toThrow("must be a stable semantic version");

		manifest.minAppVersion = "1.0.0";
		await writeJson(manifestPath, manifest);
		await writeJson(path.join(root, "versions.json"), { "2.17.3": "legacy" });
		expect(() =>
			validateCurrentVersionFiles(root, { allowPendingMinAppVersion: true }),
		).toThrow("compatibility record must be a stable semantic version");
	});

	it("materializes and validates exactly synchronized version files", async () => {
		const root = await makeTempRoot("release-source");
		const out = await makeTempRoot("release-output");
		await writeVersionFixture(root);

		const metadata = materializeVersionFiles({
			baseSha: BASE_SHA,
			out,
			root,
			version: "2.17.4",
		});
		expect(metadata).toMatchObject({ baseSha: BASE_SHA, schemaVersion: 1, version: "2.17.4" });
		expect(metadata.files).toHaveLength(4);
		expect(metadata.files.every((file) => file.sha256.length === 64 && file.size > 0)).toBe(
			true,
		);
		expect(
			validateVersionFiles({ baseRoot: root, candidateRoot: out, version: "2.17.4" }),
		).toEqual({
			version: "2.17.4",
		});

		const packageJson = JSON.parse(await fs.readFile(path.join(out, "package.json"), "utf8"));
		const packageLock = JSON.parse(
			await fs.readFile(path.join(out, "package-lock.json"), "utf8"),
		);
		const manifest = JSON.parse(await fs.readFile(path.join(out, "manifest.json"), "utf8"));
		const versions = JSON.parse(await fs.readFile(path.join(out, "versions.json"), "utf8"));
		expect(packageJson.version).toBe("2.17.4");
		expect(packageLock.version).toBe("2.17.4");
		expect(packageLock.packages[""].version).toBe("2.17.4");
		expect(manifest.version).toBe("2.17.4");
		expect(versions["2.17.4"]).toBe("1.0.0");
	});

	it("preserves released compatibility history while materializing a pending floor", async () => {
		const root = await makeTempRoot("release-pending-min-app-source");
		const out = await makeTempRoot("release-pending-min-app-output");
		await writeVersionFixture(root);
		const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
		manifest.minAppVersion = "1.11.4";
		await writeJson(path.join(root, "manifest.json"), manifest);

		materializeVersionFiles({
			baseSha: BASE_SHA,
			out,
			root,
			version: "2.18.0",
		});
		expect(
			validateVersionFiles({ baseRoot: root, candidateRoot: out, version: "2.18.0" }),
		).toEqual({ version: "2.18.0" });

		const versions = JSON.parse(await fs.readFile(path.join(out, "versions.json"), "utf8"));
		expect(versions).toEqual({
			"2.17.3": "1.0.0",
			"2.18.0": "1.11.4",
		});
	});

	it("rejects output reuse and an existing version entry", async () => {
		const root = await makeTempRoot("release-existing");
		const out = await makeTempRoot("release-nonempty");
		await writeVersionFixture(root);
		await fs.writeFile(path.join(out, "unexpected"), "x");
		expect(() =>
			materializeVersionFiles({ baseSha: BASE_SHA, out, root, version: "2.17.4" }),
		).toThrow("must be empty");

		const versions = JSON.parse(await fs.readFile(path.join(root, "versions.json"), "utf8"));
		versions["2.17.4"] = "1.0.0";
		await writeJson(path.join(root, "versions.json"), versions);
		const cleanOut = await makeTempRoot("release-clean");
		expect(() =>
			materializeVersionFiles({ baseSha: BASE_SHA, out: cleanOut, root, version: "2.17.4" }),
		).toThrow("already contains");
	});

	it("rejects a symlinked version output directory", async () => {
		const root = await makeTempRoot("release-symlink-source");
		const target = await makeTempRoot("release-symlink-target");
		const parent = await makeTempRoot("release-symlink-parent");
		const output = path.join(parent, "linked-output");
		await writeVersionFixture(root);
		await fs.symlink(target, output);
		expect(() =>
			materializeVersionFiles({
				baseSha: BASE_SHA,
				out: output,
				root,
				version: "2.17.4",
			}),
		).toThrow("real directory");
	});

	it("rejects downgrades and missing released version history", async () => {
		const root = await makeTempRoot("release-history");
		await writeVersionFixture(root);
		const downgradeOut = await makeTempRoot("release-downgrade");
		expect(() =>
			materializeVersionFiles({
				baseSha: BASE_SHA,
				out: downgradeOut,
				root,
				version: "2.17.2",
			}),
		).toThrow("must be newer");

		await writeJson(path.join(root, "versions.json"), {});
		const historyOut = await makeTempRoot("release-bad-history");
		expect(() =>
			materializeVersionFiles({
				baseSha: BASE_SHA,
				out: historyOut,
				root,
				version: "2.17.4",
			}),
		).toThrow("does not record 2.17.3");

		await writeVersionFixture(root);
		const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
		manifest.minAppVersion = "0.9.0";
		await writeJson(path.join(root, "manifest.json"), manifest);
		const loweredOut = await makeTempRoot("release-lowered-min-app");
		expect(() =>
			materializeVersionFiles({
				baseSha: BASE_SHA,
				out: loweredOut,
				root,
				version: "2.17.4",
			}),
		).toThrow("must increase from the released compatibility floor");
	});

	it.each([
		{
			file: "package.json",
			mutate: (value: Record<string, unknown>) => {
				value.scripts = { test: "malicious-command" };
			},
			error: "package.json changed outside",
		},
		{
			file: "package-lock.json",
			mutate: (value: Record<string, unknown>) => {
				value.lockfileVersion = 2;
			},
			error: "package-lock.json changed outside",
		},
		{
			file: "manifest.json",
			mutate: (value: Record<string, unknown>) => {
				value.name = "Impostor";
			},
			error: "manifest.json changed outside",
		},
	])("rejects non-version changes in $file", async ({ error, file, mutate }) => {
		const root = await makeTempRoot("release-base");
		const out = await makeTempRoot("release-candidate");
		await writeVersionFixture(root);
		materializeVersionFiles({ baseSha: BASE_SHA, out, root, version: "2.17.4" });
		const value = JSON.parse(await fs.readFile(path.join(out, file), "utf8"));
		mutate(value);
		await writeJson(path.join(out, file), value);
		expect(() =>
			validateVersionFiles({ baseRoot: root, candidateRoot: out, version: "2.17.4" }),
		).toThrow(error);
	});

	it("rejects extra versions.json mutations", async () => {
		const root = await makeTempRoot("release-version-base");
		const out = await makeTempRoot("release-version-candidate");
		await writeVersionFixture(root);
		materializeVersionFiles({ baseSha: BASE_SHA, out, root, version: "2.17.4" });
		const versions = JSON.parse(await fs.readFile(path.join(out, "versions.json"), "utf8"));
		versions["1.0.0"] = "0.1.0";
		await writeJson(path.join(out, "versions.json"), versions);
		expect(() =>
			validateVersionFiles({ baseRoot: root, candidateRoot: out, version: "2.17.4" }),
		).toThrow("versions.json changed outside");
	});
});

describe("release PR provenance", () => {
	const validInput = {
		baseRef: "master",
		branch: "release/2.17.4",
		changedFiles: ["versions.json", "package.json", "manifest.json", "package-lock.json"],
		headRepository: "chhoumann/PodNotes",
		repository: "chhoumann/PodNotes",
		title: "release(version): Release 2.17.4",
		version: "2.17.4",
	};

	it("accepts an exact same-repository release PR", () => {
		expect(validateReleasePr(validInput)).toEqual({ version: "2.17.4" });
	});

	it.each([
		[{ ...validInput, branch: "feature/release" }, "branch/version"],
		[{ ...validInput, title: "Release 2.17.4" }, "title/version"],
		[{ ...validInput, headRepository: "fork/PodNotes" }, "this repository"],
		[{ ...validInput, changedFiles: [...validInput.changedFiles, "src/main.ts"] }, "exactly"],
	])("rejects invalid release PR provenance", (input, error) => {
		expect(() => validateReleasePr(input)).toThrow(error);
	});
});

describe("release artifact manifest", () => {
	it("hashes exactly the two regular release assets", async () => {
		const root = await makeTempRoot("release-assets");
		await fs.writeFile(path.join(root, "main.js"), "bundle");
		await fs.writeFile(path.join(root, "manifest.json"), "manifest");
		const output = path.join(root, "metadata.json");
		const manifest = createArtifactManifest({
			artifacts: ["main.js", "manifest.json"],
			output,
			root,
		});
		expect(manifest.artifacts).toHaveLength(2);
		expect(JSON.parse(await fs.readFile(output, "utf8"))).toEqual(manifest);
	});

	it("rejects extra assets and symlinks", async () => {
		const root = await makeTempRoot("release-unsafe-assets");
		await fs.writeFile(path.join(root, "real-main.js"), "bundle");
		await fs.symlink(path.join(root, "real-main.js"), path.join(root, "main.js"));
		await fs.writeFile(path.join(root, "manifest.json"), "manifest");
		expect(() =>
			createArtifactManifest({ artifacts: ["main.js", "manifest.json"], root }),
		).toThrow("regular file");
		expect(() =>
			createArtifactManifest({ artifacts: ["main.js", "manifest.json", "extra.js"], root }),
		).toThrow("exactly");
	});
});
