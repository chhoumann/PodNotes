import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const directory = mkdtempSync(join(tmpdir(), "podnotes-size-"));
const script = resolve("scripts/size.mjs");
afterAll(() => rmSync(directory, { recursive: true, force: true }));

function check(name: string, contents: string | Buffer) {
	const path = join(directory, name);
	writeFileSync(path, contents);
	return spawnSync(process.execPath, [script, path], {
		encoding: "utf8",
		env: { ...process.env, GITHUB_STEP_SUMMARY: "" },
	});
}

describe("bundle budget CLI", () => {
	it("allows the raw budget boundary and rejects one extra byte", () => {
		expect(check("boundary.js", "a".repeat(330_000)).status).toBe(0);
		const result = check("over.js", "a".repeat(330_001));
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("budget 330000 bytes; OVER by 1 bytes");
	});

	it("rejects gzip growth even when raw bytes fit", () => {
		const result = check("gzip.js", randomBytes(110_000));
		expect(result.status).toBe(1);
		expect(result.stdout).toMatch(
			/gzip \(level 9\): \d+ bytes; budget 100000 bytes; OVER by \d+ bytes/,
		);
		expect(result.stdout).toContain("budget 330000 bytes; 220000 bytes remaining");
	});

	it("fails on absent or empty artifacts instead of reporting a small build", () => {
		const empty = check("empty.js", "");
		expect(empty.status).toBe(1);
		expect(empty.stderr).toContain("is empty");
		const missing = spawnSync(process.execPath, [script, join(directory, "absent.js")], {
			encoding: "utf8",
		});
		expect(missing.status).toBe(1);
		expect(missing.stderr).toContain("Bundle size check failed");
	});
});
