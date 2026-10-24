// Proves a test catches a defect. Each edit replaces the one occurrence of
// <search> in <file>. The command must pass first; with the edits in place it
// must type-check and fail <test name>. Files are always restored from memory.
//
//   npm run plant -- <test name> <file> <search> <replace> [<file> <search> <replace>...] [-- <command...>]
//
// The command defaults to the unit suite filtered to <test name>.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
	"Usage: npm run plant -- <test name> <file> <search> <replace> [<file> <search> <replace>...] [-- <command...>]";
const VITEST = fileURLToPath(new URL("../node_modules/vitest/vitest.mjs", import.meta.url));

/** @type {Map<string, string>} */
const originals = new Map();
// Only a SIGKILL skips the restore, and then this copy is the way back.
const backups = fs.mkdtempSync(path.join(os.tmpdir(), "podnotes-plant-"));
/** @type {import("node:child_process").ChildProcess | undefined} */
let child;

function restore() {
	for (const [file, original] of originals) fs.writeFileSync(file, original);
	if (originals.size > 0) process.stderr.write(`Restored ${[...originals.keys()].join(", ")}.\n`);
	originals.clear();
	fs.rmSync(backups, { recursive: true, force: true });
}

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
process.on("exit", restore);
for (const signal of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
	process.on(signal, () => {
		child?.kill(signal);
		restore();
		process.exit(128 + os.constants.signals[signal]);
	});
}

/**
 * @param {string} command @param {string[]} args
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function run(command, args) {
	return new Promise((resolve, reject) => {
		const spawned = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1" },
			// npm is a .cmd shim on Windows, which only a shell can launch.
			shell: process.platform === "win32" && command !== process.execPath,
		});
		child = spawned;
		let output = "";
		spawned.stdout.on("data", (chunk) => {
			output += chunk;
			process.stdout.write(chunk);
		});
		spawned.stderr.on("data", (chunk) => {
			output += chunk;
			process.stderr.write(chunk);
		});
		spawned.on("error", reject);
		spawned.on("close", (code) => resolve({ code, output }));
	});
}

/** @param {string} output @param {string} testName */
function failed(output, testName) {
	return output
		.split(/\r?\n/)
		.some((line) => /^\s*FAIL\s/.test(line) && line.trimEnd().endsWith(` > ${testName}`));
}

async function main() {
	const argv = process.argv.slice(2);
	const split = argv.indexOf("--");
	const [testName, ...edits] = split === -1 ? argv : argv.slice(0, split);
	if (!testName || edits.length === 0 || edits.length % 3 !== 0) throw new Error(USAGE);
	const [command, ...args] =
		split === -1
			? [
					process.execPath,
					VITEST,
					"run",
					"--configLoader",
					"bundle",
					"-t",
					`${testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
				]
			: argv.slice(split + 1);

	/** @type {Map<string, string>} */
	const planted = new Map();
	for (let index = 0; index < edits.length; index += 3) {
		const [file, search, replace] = edits.slice(index, index + 3);
		const source = planted.get(file) ?? fs.readFileSync(file, "utf8");
		const matches = source.split(search).length - 1;
		if (matches !== 1)
			throw new Error(`<search> matched ${matches} times in ${file}, not once.`);
		planted.set(
			file,
			source.replace(search, () => replace),
		);
	}

	if ((await run(command, args)).code !== 0) {
		throw new Error("The command fails without the plant, so a failure would prove nothing.");
	}
	process.stderr.write(`Backups: ${backups}\n`);
	for (const [index, [file, source]] of [...planted].entries()) {
		const original = fs.readFileSync(file, "utf8");
		fs.writeFileSync(path.join(backups, `${index}-${path.basename(file)}`), original);
		originals.set(file, original);
		fs.writeFileSync(file, source);
	}
	const check = [...planted.keys()].some((file) => file.endsWith(".svelte"))
		? "check:a11y"
		: "typecheck";
	if ((await run("npm", ["run", "--silent", check])).code !== 0) {
		throw new Error("The plant does not type-check, so no test ran. Make it compile.");
	}
	const { code, output } = await run(command, args);
	restore();
	// test:e2e built root main.js from the planted source.
	if (args.includes("test:e2e") && (await run("npm", ["run", "--silent", "build"])).code !== 0) {
		throw new Error(
			"Rebuilding main.js failed, so it still holds the plant. Run npm run build.",
		);
	}
	if (code === 0 || !failed(output, testName)) {
		throw new Error(`Not caught: "${testName}" is not a failed test in the run's summary.`);
	}
	process.stderr.write(`Caught: "${testName}" failed on the plant.\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
