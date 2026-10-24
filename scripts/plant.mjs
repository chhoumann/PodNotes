// Proves a test catches a defect: replaces the one occurrence of <search> in
// <file>, type-checks, runs the tests, and passes only when <test name> failed.
// The file is always restored from a backup copy, never from git.
//
//   npm run plant -- <file> <search> <replace> <test name> [-- <command...>]
//
// The command defaults to the unit suite filtered to <test name>.
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VITEST = fileURLToPath(new URL("../node_modules/.bin/vitest", import.meta.url));

/** @param {string} command @param {string[]} args @returns {Promise<{ code: number | null, output: string }>} */
function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
			process.stdout.write(chunk);
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
			process.stderr.write(chunk);
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, output }));
	});
}

async function main() {
	const argv = process.argv.slice(2);
	const split = argv.indexOf("--");
	const [file, search, replace, testName] = split === -1 ? argv : argv.slice(0, split);
	if (!file || !search || replace === undefined || !testName) {
		throw new Error(
			"Usage: npm run plant -- <file> <search> <replace> <test name> [-- <command...>]",
		);
	}
	const [command, ...args] =
		split === -1
			? [
					VITEST,
					"run",
					"--configLoader",
					"bundle",
					"-t",
					testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
				]
			: argv.slice(split + 1);

	const original = await fsp.readFile(file, "utf8");
	const matches = original.split(search).length - 1;
	if (matches !== 1) throw new Error(`<search> matched ${matches} times in ${file}, not once.`);

	const backup = path.join(
		await fsp.mkdtemp(path.join(os.tmpdir(), "podnotes-plant-")),
		path.basename(file),
	);
	await fsp.writeFile(backup, original);
	process.stderr.write(`Backup of ${file}: ${backup}\n`);
	try {
		await fsp.writeFile(
			file,
			original.replace(search, () => replace),
		);
		const check = file.endsWith(".svelte") ? "check:a11y" : "typecheck";
		if ((await run("npm", ["run", "--silent", check])).code !== 0) {
			throw new Error("The plant does not type-check, so no test ran. Make it compile.");
		}
		const { code, output } = await run(command, args);
		const failed = output
			.split("\n")
			.some((line) => /^\s*FAIL\s.* > /.test(line) && line.includes(testName));
		if (code === 0 || !failed) {
			throw new Error(`Not caught: no failed test named "${testName}" in the run's summary.`);
		}
		process.stderr.write(`Caught: "${testName}" failed on the plant.\n`);
	} finally {
		await fsp.copyFile(backup, file);
		process.stderr.write(`Restored ${file}.\n`);
		if (command === "npm" && args.includes("test:e2e")) {
			// test:e2e built root main.js from the planted source.
			await run("npm", ["run", "--silent", "build"]);
		}
	}
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
