import fs from "node:fs/promises";
import path from "node:path";
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
