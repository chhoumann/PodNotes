import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateReleasePlan, incrementVersion } from "./release-plan.mjs";

const tempRoots: string[] = [];

function git(cwd: string, args: string[]) {
	return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

async function writeSynchronizedVersion(root: string, version: string) {
	let versions: Record<string, string> = {};
	try {
		versions = JSON.parse(await fs.readFile(path.join(root, "versions.json"), "utf8"));
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	versions[version] = "1.0.0";
	await Promise.all([
		fs.writeFile(
			path.join(root, "package.json"),
			`${JSON.stringify(
				{
					name: "podnotes",
					repository: { url: "https://github.com/chhoumann/PodNotes.git" },
					version,
				},
				null,
				2,
			)}\n`,
		),
		fs.writeFile(
			path.join(root, "package-lock.json"),
			`${JSON.stringify(
				{
					lockfileVersion: 3,
					name: "podnotes",
					packages: { "": { name: "podnotes", version } },
					version,
				},
				null,
				2,
			)}\n`,
		),
		fs.writeFile(
			path.join(root, "manifest.json"),
			`${JSON.stringify({ id: "podnotes", minAppVersion: "1.0.0", version }, null, 2)}\n`,
		),
		fs.writeFile(path.join(root, "versions.json"), `${JSON.stringify(versions, null, 2)}\n`),
	]);
}

async function releaseRepository() {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "podnotes-release-plan-"));
	tempRoots.push(root);
	git(root, ["init", "--initial-branch=master"]);
	git(root, ["config", "user.name", "PodNotes Test"]);
	git(root, ["config", "user.email", "podnotes@example.com"]);
	await writeSynchronizedVersion(root, "2.17.3");
	git(root, ["add", "package.json", "package-lock.json", "manifest.json", "versions.json"]);
	git(root, ["commit", "-m", "release(version): Release 2.17.3"]);
	git(root, ["tag", "2.17.3"]);
	return root;
}

function commit(cwd: string, message: string) {
	execFileSync("git", ["commit", "--allow-empty", "-m", message], {
		cwd,
		env: {
			...process.env,
			GIT_AUTHOR_DATE: "2024-03-04T12:00:00Z",
			GIT_COMMITTER_DATE: "2024-03-04T12:00:00Z",
		},
	});
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(
		tempRoots.splice(0).map((root) => fs.rm(root, { force: true, recursive: true })),
	);
});

describe("release plan", () => {
	it("emits an explicit no-release plan", async () => {
		const root = await releaseRepository();
		commit(root, "docs: clarify installation");
		const plan = await calculateReleasePlan({ cwd: root });
		expect(plan).toMatchObject({ notes: "", release: false, schemaVersion: 1 });
		expect(plan.baseSha).toBe(git(root, ["rev-parse", "HEAD"]));
	});

	it.each([
		["fix: correct playback", "patch", "2.17.4"],
		["feat: add chapter navigation", "minor", "2.18.0"],
		[
			"feat: replace the public API\n\nBREAKING CHANGE: consumers must use the new API",
			"major",
			"3.0.0",
		],
		["chore: modernize tooling", "patch", "2.17.4"],
		["build(deps): update Vite", "patch", "2.17.4"],
	] as const)("plans %s as a %s release", async (message, type, version) => {
		const root = await releaseRepository();
		commit(root, message);
		const plan = await calculateReleasePlan({ cwd: root });
		expect(plan).toMatchObject({
			nextVersion: version,
			previousVersion: "2.17.3",
			release: true,
			releaseType: type,
			schemaVersion: 1,
		});
		expect(plan.notes.trim()).not.toBe("");
		expect(plan.notes).toContain("(2024-03-04)");
	});

	it("ignores a release commit after the latest tag", async () => {
		const root = await releaseRepository();
		commit(root, "release(version): Release 2.17.3");
		await expect(calculateReleasePlan({ cwd: root })).resolves.toMatchObject({
			release: false,
		});
	});

	it("recomputes an expected release when its recovery tag already targets HEAD", async () => {
		const root = await releaseRepository();
		commit(root, "fix: correct playback");
		await writeSynchronizedVersion(root, "2.17.4");
		git(root, ["add", "package.json", "package-lock.json", "manifest.json", "versions.json"]);
		commit(root, "release(version): Release 2.17.4");
		git(root, ["tag", "2.17.4"]);
		await expect(
			calculateReleasePlan({ cwd: root, expectedVersion: "2.17.4" }),
		).resolves.toMatchObject({
			nextVersion: "2.17.4",
			previousVersion: "2.17.3",
			release: true,
		});
	});

	it("rejects an expected recovery tag that does not target HEAD", async () => {
		const root = await releaseRepository();
		git(root, ["checkout", "--quiet", "-b", "stray-release"]);
		commit(root, "docs: create a divergent tag");
		git(root, ["tag", "2.17.4"]);
		git(root, ["checkout", "--quiet", "master"]);
		commit(root, "fix: correct playback");
		await expect(
			calculateReleasePlan({ cwd: root, expectedVersion: "2.17.4" }),
		).rejects.toThrow("not HEAD");
	});

	it("provides deterministic fallback notes", async () => {
		const root = await releaseRepository();
		commit(root, "fix: correct playback");
		const plan = await calculateReleasePlan({
			cwd: root,
			notesGenerator: vi.fn(async () => ""),
		});
		expect(plan.notes).toBe("## 2.17.4\n\nMaintenance release.\n");
	});

	it("increments stable versions and rejects unsupported release types", () => {
		expect(incrementVersion("2.17.3", "patch")).toBe("2.17.4");
		expect(incrementVersion("2.17.3", "minor")).toBe("2.18.0");
		expect(incrementVersion("2.17.3", "major")).toBe("3.0.0");
		expect(() => incrementVersion("2.17.3", "prerelease")).toThrow("Unsupported");
	});
});
