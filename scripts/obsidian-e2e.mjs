// The repo's e2e command. `test` runs tests/e2e against this worktree's isolated
// Obsidian instance, `screenshot` and `record` capture the PodNotes player,
// `capture` is upstream `obsidian-e2e capture` against the instance, and
// provision, start, stop and run go to the obsidian-e2e instance runner.
import { spawn } from "node:child_process";
import { once } from "node:events";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	execObsidian,
	loadRunnerConfig,
	obsidianCommandArgs,
	resolveInstanceOptions,
	resolveProvisionOptions,
	runObsidianE2ECli,
} from "obsidian-e2e/runner";
import { podNotesRunnerDependencies } from "./e2e-instance.mjs";

/** @typedef {import("obsidian-e2e/runner").InstanceOptions} InstanceOptions */

const linux = process.platform === "linux";

/** @param {InstanceOptions} instance */
async function cdpEnv(instance) {
	try {
		const [port] = (
			await fsp.readFile(path.join(instance.userDataPath, "DevToolsActivePort"), "utf8")
		).split("\n");
		return { ...process.env, OBSIDIAN_E2E_CDP_PORT: port };
	} catch {
		throw new Error(
			"This worktree's Obsidian instance is not running: npm run start:e2e-obsidian",
		);
	}
}

const VITEST = fileURLToPath(new URL("../node_modules/.bin/vitest", import.meta.url));
const PLAYER_SELECTOR = '.workspace-leaf-content[data-type="podcast_player_view"]';
// Waits for the same non-zero box on two consecutive checks, so a capture never
// races the sidebar opening.
const OPEN_PLAYER = `(async () => {
	if (!app.commands.executeCommandById("podnotes:podnotes-show-leaf")) return false;
	let last = "";
	for (let i = 0; i < 100; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const rect = document.querySelector(${JSON.stringify(PLAYER_SELECTOR)})?.getBoundingClientRect();
		const box = rect && rect.width > 0 && rect.height > 0 ? JSON.stringify(rect) : "";
		if (box && box === last) return true;
		last = box;
	}
	return false;
})()`;
const CDP_CAPTURE_VERBS = ["prepare", "screenshot", "type", "record"];
/** @type {NodeJS.Signals[]} */
const FORWARDED_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

async function defaultInstance() {
	const cwd = process.cwd();
	const config = await loadRunnerConfig(cwd);
	return resolveInstanceOptions(resolveProvisionOptions({}, config, cwd), {}, config, cwd);
}

/** @param {string[]} args Vitest arguments. */
async function runTests(args) {
	const instance = await defaultInstance();
	const results = path.join(os.tmpdir(), `podnotes-e2e-${process.pid}.json`);
	let launched = false;
	/** @type {import("node:child_process").ChildProcess | undefined} */
	let child;
	/** @type {NodeJS.Signals | undefined} */
	let interrupted;
	/** @param {NodeJS.Signals} signal */
	const onSignal = (signal) => {
		interrupted ??= signal;
		try {
			// Vitest leads its own process group, so its fork workers stop with it.
			// A signal this wrapper does not handle, or SIGKILL, still orphans it.
			if (child?.pid) process.kill(-child.pid, signal);
		} catch {}
	};
	for (const signal of FORWARDED_SIGNALS) process.on(signal, onSignal);
	try {
		const deps = podNotesRunnerDependencies(() => {
			launched = true;
		});
		const started = await runObsidianE2ECli(["start"], deps);
		if (started !== 0) return started;
		if (interrupted) return 128 + os.constants.signals[interrupted];
		child = spawn(
			VITEST,
			[
				"run",
				"--config",
				"vitest.e2e.config.ts",
				"--configLoader",
				"bundle",
				"--reporter=verbose",
				"--reporter=json",
				`--outputFile.json=${results}`,
				...args,
			],
			{
				detached: true,
				stdio: "inherit",
				env: {
					...process.env,
					OBSIDIAN_BIN: instance.obsidianBin,
					OBSIDIAN_E2E_VAULT: instance.vaultName,
					OBSIDIAN_E2E_VAULT_PATH: instance.vaultPath,
					OBSIDIAN_E2E_OBSIDIAN_HOME: instance.obsidianHome,
				},
			},
		);
		const [code, signal] = await once(child, "close");
		const stoppedBy = interrupted ?? signal;
		if (stoppedBy) return 128 + os.constants.signals[/** @type {NodeJS.Signals} */ (stoppedBy)];
		if (code !== 0) return code;
		// Vitest exits 0 when a filter matches no test.
		const { numPassedTests, numFailedTests } = JSON.parse(await fsp.readFile(results, "utf8"));
		if (numPassedTests + numFailedTests === 0) {
			process.stderr.write(
				`No e2e test ran: the arguments matched no test (${args.join(" ")}).\n`,
			);
			return 1;
		}
		return 0;
	} finally {
		for (const signal of FORWARDED_SIGNALS) process.off(signal, onSignal);
		await fsp.rm(results, { force: true });
		if (launched) await runObsidianE2ECli(["stop"]);
	}
}

/** @param {string} verb */
function requireLinux(verb) {
	if (!linux) {
		throw new Error(`${verb} is Linux-only; on macOS use \`npx obsidian-e2e capture launch\`.`);
	}
}

/** @param {string[]} args */
async function captureUpstream(args) {
	if (!CDP_CAPTURE_VERBS.includes(args[0])) return runObsidianE2ECli(["capture", ...args]);
	requireLinux("capture");
	return runObsidianE2ECli(["capture", ...args], { env: await cdpEnv(await defaultInstance()) });
}

/**
 * @param {"screenshot" | "record"} verb
 * @param {string[]} args
 */
async function capturePlayer(verb, args) {
	requireLinux(verb);
	const [output, separator, ...driver] = args;
	/** @type {string[] | undefined} */
	let captureArgs;
	if (verb === "screenshot") {
		if (output && args.length === 1) {
			captureArgs = ["screenshot", output, "--selector", PLAYER_SELECTOR];
		}
	} else if (output && (args.length === 1 || (separator === "--" && driver.length > 0))) {
		// Upstream rejects a take whose encoded duration drifts more than max(0.5 s,
		// 2 frames) from wall clock; x11grab's lead-in frames stay under that at 30 fps.
		const take = driver.length > 0 ? driver : ["sleep", "3"];
		captureArgs = ["record", output, "--fps", "30", "--", ...take];
	}
	if (!captureArgs) {
		throw new Error(
			verb === "screenshot"
				? "Usage: screenshot <out.png>"
				: "Usage: record <out.mp4|out.webm> [-- <driver command...>]",
		);
	}
	const instance = await defaultInstance();
	// `run` brings the instance up without reloading PodNotes, which `start` would
	// do, so state a driver set up survives. `version` also records the app build.
	const up = await runObsidianE2ECli(["run", "version"], podNotesRunnerDependencies());
	if (up !== 0) return up;
	const { stdout } = await execObsidian(
		instance,
		obsidianCommandArgs(instance.vaultName, ["eval", `code=${OPEN_PLAYER}`]),
	);
	if (!stdout.trim().endsWith("=> true")) throw new Error("The PodNotes player did not open.");
	await fsp.mkdir(path.dirname(path.resolve(output)), { recursive: true });
	return runObsidianE2ECli(["capture", ...captureArgs], { env: await cdpEnv(instance) });
}

/** @param {string[]} argv */
function main(argv) {
	const [verb, ...rest] = argv;
	switch (verb) {
		case "test":
			return runTests(rest);
		case "capture":
			return captureUpstream(rest);
		case "screenshot":
		case "record":
			return capturePlayer(verb, rest);
	}
	return runObsidianE2ECli(argv, verb === "stop" ? {} : podNotesRunnerDependencies());
}

// Same exit guard as the upstream bin: capture and signal exits must not hang on
// a socket whose peer stopped answering.
const argv = process.argv.slice(2);
/** @param {number} code */
function exit(code) {
	process.exitCode = code;
	if (code >= 128 || ["capture", "screenshot", "record"].includes(argv[0])) {
		setTimeout(() => process.exit(code), 2000).unref();
	}
}
main(argv).then(exit, (error) => {
	process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
	exit(1);
});
