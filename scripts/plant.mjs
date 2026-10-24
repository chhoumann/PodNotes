// Proves a test catches a defect. Each edit replaces the one occurrence of
// <search> in <file>. With the edits in place the code must type-check and the
// command must fail <test name>; with them restored, the command must pass.
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
// npm's own entry point, so no shell has to launch npm's Windows shim.
const NPM = process.env.npm_execpath ? [process.execPath, process.env.npm_execpath] : ["npm"];

/** @type {Map<string, { original: string, planted: string }>} */
const files = new Map();
// Only a SIGKILL skips the restore, and then this copy is the way back.
const backups = fs.mkdtempSync(path.join(os.tmpdir(), "podnotes-plant-"));
/** @type {import("node:child_process").ChildProcess | undefined} */
let child;
let keepBackups = false;

/** Restores every planted file, unless one changed during the run. */
function restore() {
	const changed = [...files.keys()].filter(
		(file) => fs.readFileSync(file, "utf8") !== files.get(file)?.planted,
	);
	if (changed.length > 0) {
		files.clear();
		keepBackups = true;
		process.stderr.write(
			`${changed.join(", ")} changed during the run, so nothing was restored. Originals: ${backups}\n`,
		);
		process.exitCode = 1;
		return false;
	}
	for (const [file, { original }] of files) fs.writeFileSync(file, original);
	if (files.size > 0) process.stderr.write(`Restored ${[...files.keys()].join(", ")}.\n`);
	files.clear();
	if (!keepBackups) fs.rmSync(backups, { recursive: true, force: true });
	return true;
}

process.stdout.on("error", () => {});
process.stderr.on("error", () => {});
process.on("exit", restore);
for (const signal of /** @type {NodeJS.Signals[]} */ (["SIGINT", "SIGTERM", "SIGHUP"])) {
	process.on(signal, () => {
		child?.kill(signal);
		restore();
		process.stderr.write(
			"Interrupted: a build in the run may hold the plant. Run npm run build.\n",
		);
		process.exit(128 + os.constants.signals[signal]);
	});
}

/**
 * @param {string[]} command
 * @returns {Promise<{ code: number | null, output: string }>}
 */
function run([command, ...args]) {
	return new Promise((resolve, reject) => {
		const spawned = spawn(command, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, NO_COLOR: "1" },
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

async function main() {
	const argv = process.argv.slice(2);
	const split = argv.indexOf("--");
	const [testName, ...edits] = split === -1 ? argv : argv.slice(0, split);
	if (!testName || edits.length === 0 || edits.length % 3 !== 0) throw new Error(USAGE);
	const [first, ...rest] = split === -1 ? [] : argv.slice(split + 1);
	const command =
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
			: [...(first === "npm" ? NPM : [first]), ...rest];

	/** @type {Map<string, string>} */
	const originals = new Map();
	/** @type {Map<string, string>} */
	const sources = new Map();
	for (let index = 0; index < edits.length; index += 3) {
		const [name, search, replace] = edits.slice(index, index + 3);
		const file = path.resolve(name);
		if (!originals.has(file)) originals.set(file, fs.readFileSync(file, "utf8"));
		const source = sources.get(file) ?? /** @type {string} */ (originals.get(file));
		const matches = source.split(search).length - 1;
		if (matches !== 1)
			throw new Error(`<search> matched ${matches} times in ${name}, not once.`);
		sources.set(
			file,
			source.replace(search, () => replace),
		);
	}

	process.stderr.write(`Backups: ${backups}\n`);
	for (const [file, planted] of sources) {
		const original = /** @type {string} */ (originals.get(file));
		fs.writeFileSync(path.join(backups, `${files.size}-${path.basename(file)}`), original);
		files.set(file, { original, planted });
		fs.writeFileSync(file, planted);
	}
	const check = [...sources.keys()].some((file) => file.endsWith(".svelte"))
		? "check:a11y"
		: "typecheck";
	if ((await run([...NPM, "run", "--silent", check])).code !== 0) {
		throw new Error("The plant does not type-check, so no test ran. Make it compile.");
	}
	const { code, output } = await run(command);
	if (!restore()) return;
	// Restored, the command must pass, or a failure proves nothing. A build in it
	// also replaces anything built from the plant.
	const baseline = await run(command);
	const caught = output
		.split(/\r?\n/)
		.filter((line) => /^\s*FAIL\s/.test(line) && line.trimEnd().endsWith(` > ${testName}`));
	if (code === 0 || caught.length === 0) {
		throw new Error(`Not caught: "${testName}" is not a failed test in the run's summary.`);
	}
	if (baseline.code !== 0) {
		throw new Error("The command also fails without the plant, so its failure proves nothing.");
	}
	process.stderr.write(`Caught by:\n${caught.map((line) => line.trim()).join("\n")}\n`);
}

main().catch((error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	process.exitCode = 1;
});
