import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const scriptPath = resolve(process.cwd(), "version-bump.mjs");

describe("version-bump", () => {
	it("fails clearly before reading project files when npm_package_version is missing", () => {
		const result = spawnSync(process.execPath, [scriptPath], {
			cwd: tmpdir(),
			encoding: "utf8",
			env: {
				...process.env,
				npm_package_version: "",
			},
		});

		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(
			"npm_package_version is required; run this script through `npm version`.",
		);
	});
});
