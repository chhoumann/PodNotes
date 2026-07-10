import fs from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const RELEASE_TITLE = "release(version): Release 2.18.0";
const RELEASE_PR = 265;
const WORKFLOW_PATHS = [
	".github/workflows/release-trigger.yml",
	".github/workflows/release.yml",
] as const;

type MergeSubjectValidator = (
	message: string,
	expectedTitle: string,
	expectedPullNumber: number,
) => boolean;

type ReleaseTagContract = {
	createOrResolveReleaseTag(options: {
		resolve: () => Promise<string | null>;
		create: () => Promise<unknown>;
		sleep: (delayMs: number) => Promise<unknown>;
		retryDelays?: number[];
	}): Promise<string | null>;
	assertExpectedReleaseTag(
		tagSha: string | null,
		expectedSha: string,
		releaseVersion: string,
	): void;
};

type ReleaseCompatibilityContract = {
	validateCompatibilityTransition(input: {
		baseManifest: { minAppVersion?: unknown };
		baseVersion: string;
		baseVersions: Record<string, unknown>;
		nextManifest: { minAppVersion?: unknown };
		nextVersion: string;
		nextVersions: Record<string, unknown>;
	}): void;
	assertReleasedHistoryUnchanged(
		baseVersions: Record<string, unknown>,
		tagVersions: Record<string, unknown>,
	): void;
};

async function readMergeSubjectValidator(workflowPath: string) {
	const workflow = await fs.readFile(path.resolve(workflowPath), "utf8");
	const functionStart = workflow.indexOf("            function isAllowedReleaseMergeSubject");
	expect(
		functionStart,
		`${workflowPath} must define the merge-subject validator`,
	).toBeGreaterThanOrEqual(0);
	const functionEnd = workflow.indexOf("\n            }", functionStart);
	expect(functionEnd, `${workflowPath} must close the merge-subject validator`).toBeGreaterThan(
		functionStart,
	);
	const source = workflow
		.slice(functionStart, functionEnd + "\n            }".length)
		.replace(/^ {12}/gm, "");
	return runInNewContext(`(${source})`) as MergeSubjectValidator;
}

async function readReleaseTagContract() {
	const workflowPath = ".github/workflows/release.yml";
	const workflow = await fs.readFile(path.resolve(workflowPath), "utf8");
	const startMarker = "            // BEGIN release-tag-visibility-contract";
	const endMarker = "            // END release-tag-visibility-contract";
	const start = workflow.indexOf(startMarker);
	const end = workflow.indexOf(endMarker, start);
	expect(start, `${workflowPath} must define the tag-visibility contract`).toBeGreaterThanOrEqual(
		0,
	);
	expect(end, `${workflowPath} must close the tag-visibility contract`).toBeGreaterThan(start);
	const source = workflow.slice(start + startMarker.length, end).replace(/^ {12}/gm, "");
	return runInNewContext(`(() => {
		${source}
		return { createOrResolveReleaseTag, assertExpectedReleaseTag };
	})()`) as ReleaseTagContract;
}

async function readReleaseCompatibilityContract() {
	const workflowPath = ".github/workflows/release-trigger.yml";
	const workflow = await fs.readFile(path.resolve(workflowPath), "utf8");
	const startMarker = "            // BEGIN release-compatibility-contract";
	const endMarker = "            // END release-compatibility-contract";
	const start = workflow.indexOf(startMarker);
	const end = workflow.indexOf(endMarker, start);
	expect(
		start,
		`${workflowPath} must define the release-compatibility contract`,
	).toBeGreaterThanOrEqual(0);
	expect(end, `${workflowPath} must close the release-compatibility contract`).toBeGreaterThan(
		start,
	);
	const source = workflow.slice(start + startMarker.length, end).replace(/^ {12}/gm, "");
	return runInNewContext(
		`(() => {
			${source}
			return { validateCompatibilityTransition, assertReleasedHistoryUnchanged };
		})()`,
		{ isDeepStrictEqual },
	) as ReleaseCompatibilityContract;
}

describe.each(WORKFLOW_PATHS)("%s release merge-subject contract", (workflowPath) => {
	it.each([
		[RELEASE_TITLE, true],
		[`${RELEASE_TITLE}\n\npodnotes-release-commit schema=1 version=2.18.0`, true],
		[`${RELEASE_TITLE} (#${RELEASE_PR})`, true],
		[`${RELEASE_TITLE} (#${RELEASE_PR})\n\nGitHub-generated body`, true],
		[`${RELEASE_TITLE} (#264)`, false],
		[`${RELEASE_TITLE} (#${RELEASE_PR}) extra`, false],
		[` ${RELEASE_TITLE}`, false],
		[`${RELEASE_TITLE} `, false],
		["release(version): Release 2.18.1", false],
	])("validates the exact merge subject in %j", async (message, expected) => {
		const validate = await readMergeSubjectValidator(workflowPath);
		expect(validate(message, RELEASE_TITLE, RELEASE_PR)).toBe(expected);
	});

	it("uses the validator for the fetched release commit", async () => {
		const workflow = await fs.readFile(path.resolve(workflowPath), "utf8");
		expect(workflow).toContain(
			"if (!isAllowedReleaseMergeSubject(releaseCommit.data.message, title, pullNumber)) {",
		);
	});
});

describe("release tag visibility contract", () => {
	const expectedSha = "9b65d91ec47b56f61dedbfb78210734c4f29b2d5";

	it("returns an already visible exact tag without creating or waiting", async () => {
		const contract = await readReleaseTagContract();
		let createCalls = 0;
		const sleeps: number[] = [];
		await expect(
			contract.createOrResolveReleaseTag({
				resolve: async () => expectedSha,
				create: async () => {
					createCalls += 1;
				},
				sleep: async (delayMs) => {
					sleeps.push(delayMs);
				},
			}),
		).resolves.toBe(expectedSha);
		expect(createCalls).toBe(0);
		expect(sleeps).toEqual([]);
	});

	it("retries a successful create until the tag becomes visible", async () => {
		const contract = await readReleaseTagContract();
		const resolutions = [null, null, expectedSha];
		let createCalls = 0;
		const sleeps: number[] = [];
		await expect(
			contract.createOrResolveReleaseTag({
				resolve: async () => resolutions.shift() ?? null,
				create: async () => {
					createCalls += 1;
				},
				sleep: async (delayMs) => {
					sleeps.push(delayMs);
				},
				retryDelays: [0, 10, 20],
			}),
		).resolves.toBe(expectedSha);
		expect(createCalls).toBe(1);
		expect(sleeps).toEqual([10]);
	});

	it("retries after a concurrent-create 422 response", async () => {
		const contract = await readReleaseTagContract();
		const resolutions = [null, null, expectedSha];
		await expect(
			contract.createOrResolveReleaseTag({
				resolve: async () => resolutions.shift() ?? null,
				create: async () => Promise.reject({ status: 422 }),
				sleep: async () => undefined,
				retryDelays: [0, 1],
			}),
		).resolves.toBe(expectedSha);
	});

	it("fails closed on a non-race create error", async () => {
		const contract = await readReleaseTagContract();
		await expect(
			contract.createOrResolveReleaseTag({
				resolve: async () => null,
				create: async () => Promise.reject({ status: 500 }),
				sleep: async () => undefined,
			}),
		).rejects.toMatchObject({ status: 500 });
	});

	it("stops after the bounded retry schedule when the tag stays absent", async () => {
		const contract = await readReleaseTagContract();
		let resolveCalls = 0;
		const sleeps: number[] = [];
		await expect(
			contract.createOrResolveReleaseTag({
				resolve: async () => {
					resolveCalls += 1;
					return null;
				},
				create: async () => undefined,
				sleep: async (delayMs) => {
					sleeps.push(delayMs);
				},
			}),
		).resolves.toBeNull();
		expect(resolveCalls).toBe(9);
		expect(sleeps).toEqual([250, 500, 1000, 2000, 4000, 8000, 16000]);
	});

	it("rejects an absent or wrong tag SHA", async () => {
		const contract = await readReleaseTagContract();
		expect(() =>
			contract.assertExpectedReleaseTag(expectedSha, expectedSha, "2.18.1"),
		).not.toThrow();
		expect(() => contract.assertExpectedReleaseTag(null, expectedSha, "2.18.1")).toThrow(
			`Tag 2.18.1 points to null, expected ${expectedSha}.`,
		);
		expect(() =>
			contract.assertExpectedReleaseTag("f".repeat(40), expectedSha, "2.18.1"),
		).toThrow(`Tag 2.18.1 points to ${"f".repeat(40)}, expected ${expectedSha}.`);
	});

	it("wraps the real tag create call and validates its resolved SHA", async () => {
		const workflow = await fs.readFile(path.resolve(".github/workflows/release.yml"), "utf8");
		expect(workflow).toContain("const tagSha = await createOrResolveReleaseTag({");
		expect(workflow).toContain("create: () => github.rest.git.createRef({");
		expect(workflow).toContain("assertExpectedReleaseTag(tagSha, releaseSha, version);");
	});
});

describe("release compatibility transition contract", () => {
	const transition = {
		baseManifest: { minAppVersion: "1.11.4" },
		baseVersion: "2.18.2",
		baseVersions: { "2.18.2": "0.15.9" },
		nextManifest: { minAppVersion: "1.11.4" },
		nextVersion: "2.19.0",
		nextVersions: { "2.18.2": "0.15.9", "2.19.0": "1.11.4" },
	};

	it("accepts a pending compatibility floor without rewriting the released version", async () => {
		const contract = await readReleaseCompatibilityContract();
		expect(() => contract.validateCompatibilityTransition(transition)).not.toThrow();
	});

	it("rejects a missing released compatibility record", async () => {
		const contract = await readReleaseCompatibilityContract();
		expect(() =>
			contract.validateCompatibilityTransition({ ...transition, baseVersions: {} }),
		).toThrow("Released version 2.18.2 has no compatibility record");
	});

	it("rejects a new release that is not mapped to its manifest floor", async () => {
		const contract = await readReleaseCompatibilityContract();
		expect(() =>
			contract.validateCompatibilityTransition({
				...transition,
				nextVersions: { ...transition.nextVersions, "2.19.0": "0.15.9" },
			}),
		).toThrow("New release compatibility does not match its manifest");
	});

	it("rejects empty pending compatibility values", async () => {
		const contract = await readReleaseCompatibilityContract();
		expect(() =>
			contract.validateCompatibilityTransition({
				...transition,
				baseManifest: { minAppVersion: "" },
			}),
		).toThrow("Manifest compatibility versions must be stable semantic versions");
	});

	it("rejects invalid or lowered pending compatibility floors", async () => {
		const contract = await readReleaseCompatibilityContract();
		expect(() =>
			contract.validateCompatibilityTransition({
				...transition,
				baseManifest: { minAppVersion: "latest" },
			}),
		).toThrow("Manifest compatibility versions must be stable semantic versions");
		expect(() =>
			contract.validateCompatibilityTransition({
				...transition,
				baseManifest: { minAppVersion: "0.14.0" },
			}),
		).toThrow("Pending manifest compatibility must increase the released floor");
	});

	it("requires released history to match the previous stable tag exactly", async () => {
		const contract = await readReleaseCompatibilityContract();
		expect(() =>
			contract.assertReleasedHistoryUnchanged(
				transition.baseVersions,
				structuredClone(transition.baseVersions),
			),
		).not.toThrow();
		expect(() =>
			contract.assertReleasedHistoryUnchanged(transition.baseVersions, {
				"2.18.2": "1.11.4",
			}),
		).toThrow("Released compatibility history changed after the previous tag");
	});

	it("wires both compatibility checks into the fetched release provenance path", async () => {
		const workflow = await fs.readFile(
			path.resolve(".github/workflows/release-trigger.yml"),
			"utf8",
		);
		expect(workflow).toContain("validateCompatibilityTransition({");
		expect(workflow).toContain("assertReleasedHistoryUnchanged(baseVersions, tagVersions);");
	});
});
