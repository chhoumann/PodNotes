// Temporary bridge in front of the obsidian-e2e instance runner (0.12), which
// only launches Obsidian on macOS. On macOS the runner verbs behave exactly like
// the upstream bin. On Linux this adds a headless launch, a private CLI socket per
// instance, Linux version-guard sources and a CDP port for `capture`. Delete each
// Linux piece once upstream ships the change in its row:
//
//   launchLinux                     launchObsidianInstance grows a Linux branch
//                                   (xvfb-run without DISPLAY, --no-sandbox)
//   delete XDG_RUNTIME_DIR,         the runner's obsidianEnv and --print-env
//   startPrintEnv                   isolate the Linux CLI socket
//   versionSources,                 Linux version sources upstream, or an exported
//   guardWarmInstance               guardWarmInstance
//   cdpEnv                          launch with --remote-debugging-port=0 and print
//                                   OBSIDIAN_E2E_CDP_PORT from start --print-env
//
// `test` (zero-test guard, leak-free teardown) and the PodNotes capture presets
// stay until upstream grows equivalents.
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertObsidianMeetsMinAppVersion,
	ensureObsidianInstance,
	ensureSecureDir,
	isInstanceReady,
	loadRunnerConfig,
	readInstanceMarker,
	resolveInstanceOptions,
	resolveProvisionOptions,
	runObsidianE2ECli,
} from "obsidian-e2e/runner";

/** @typedef {import("obsidian-e2e/runner").CliDependencies} CliDependencies */
/** @typedef {import("obsidian-e2e/runner").LaunchTarget} LaunchTarget */

const linux = process.platform === "linux";
const VITEST = fileURLToPath(new URL("../node_modules/.bin/vitest", import.meta.url));
const PLAYER_SELECTOR = '.workspace-leaf-content[data-type="podcast_player_view"]';
// Opens the player through its command, then waits until the view has the same
// non-zero box on two consecutive checks, so a capture never races the sidebar.
const OPEN_PLAYER = `(async () => {
	app.commands.executeCommandById("podnotes:podnotes-show-leaf");
	let last = "";
	for (let i = 0; i < 100; i++) {
		await new Promise((resolve) => setTimeout(resolve, 100));
		const rect = document.querySelector(${JSON.stringify(PLAYER_SELECTOR)})?.getBoundingClientRect();
		const box = rect && rect.width > 0 && rect.height > 0 ? JSON.stringify(rect) : "";
		if (box && box === last) return true;
		last = box;
	}
	throw new Error("The PodNotes player did not open.");
})()`;

// Linux Obsidian and its CLI client put the socket in $XDG_RUNTIME_DIR when it
// is set, so every instance would share one socket. Without it both fall back
// to $HOME, which the runner already makes private per instance.
if (linux) delete process.env.XDG_RUNTIME_DIR;

/** @param {string} obsidianApp */
function linuxExecutable(obsidianApp) {
	return path.isAbsolute(obsidianApp) ? obsidianApp : "/opt/Obsidian/obsidian";
}

/** @param {string} obsidianApp */
function versionSources(obsidianApp) {
	return {
		bundledAsarCandidates: [
			path.join(path.dirname(linuxExecutable(obsidianApp)), "resources", "obsidian.asar"),
		],
		obsidianConfigDir: path.join(os.userInfo().homedir, ".config", "obsidian"),
	};
}

/** @param {LaunchTarget} target */
async function launchLinux(target) {
	await ensureSecureDir(target.profileRoot);
	await ensureSecureDir(target.instancePath);
	/** @type {NodeJS.ProcessEnv} */
	const env = {
		...process.env,
		HOME: target.obsidianHome,
		// A clicked obsidian:// link relaunches Obsidian through xdg-open without
		// --user-data-dir. With this default profile it finds this instance's
		// single-instance lock and hands the URL over instead of starting a second app.
		XDG_CONFIG_HOME: path.dirname(target.userDataPath),
		XDG_SESSION_TYPE: "x11",
		// Marks the display as private, so `capture record` picks x11grab.
		OBSIDIAN_E2E_CAPTURE_XVFB: "1",
	};
	delete env.WAYLAND_DISPLAY;
	delete env.WAYLAND_SOCKET;
	const log = fs.openSync(path.join(target.obsidianHome, "Library", "Logs", "obsidian.log"), "a");
	try {
		const child = spawn(
			"xvfb-run",
			[
				"-a",
				"-s",
				"-screen 0 3840x3200x24",
				linuxExecutable(target.obsidianApp),
				"--no-sandbox",
				"--remote-debugging-port=0",
				`--user-data-dir=${target.userDataPath}`,
				"--password-store=basic",
			],
			{ detached: true, stdio: ["ignore", log, log], env },
		);
		await once(child, "spawn");
		child.unref();
	} finally {
		fs.closeSync(log);
	}
}

/** @type {NonNullable<CliDependencies["guardWarmInstance"]>} */
async function guardWarmInstance(options, deps = {}) {
	if (options.skipVersionGuard) return;
	const marker = await readInstanceMarker(options.instancePath);
	const { appVersion } = await assertObsidianMeetsMinAppVersion({
		worktreePath: options.worktreePath,
		...versionSources(options.obsidianApp),
	});
	if (marker?.appVersion && marker.appVersion !== appVersion) {
		throw new Error(
			`Refusing to reuse the warm Obsidian instance for ${options.vaultName}: it was launched against app version ${marker.appVersion}, but the resolved app version is now ${appVersion}. Stop it and let the next run relaunch it: npm run stop:e2e-obsidian`,
		);
	}
	if (!marker?.appVersion) {
		deps.log?.(
			"Reusing a warm Obsidian instance with no recorded app version; a mid-session Obsidian update cannot be detected until it is relaunched.",
		);
	}
}

/** @type {CliDependencies} */
const runnerDeps = linux
	? {
			ensureObsidianInstance: (options, config, deps) =>
				ensureObsidianInstance(options, config, {
					...deps,
					...versionSources(options.obsidianApp),
					launchObsidianInstance: launchLinux,
				}),
			guardWarmInstance,
		}
	: {};

/** This worktree's default instance, resolved exactly like the runner verbs resolve it. */
async function defaultInstance() {
	const cwd = process.cwd();
	const config = await loadRunnerConfig(cwd);
	return resolveInstanceOptions(resolveProvisionOptions({}, config, cwd), {}, config, cwd);
}

/** Env for upstream `capture` that targets this worktree's instance. */
async function cdpEnv() {
	const { userDataPath } = await defaultInstance();
	try {
		const [port] = (
			await fsp.readFile(path.join(userDataPath, "DevToolsActivePort"), "utf8")
		).split("\n");
		return { ...process.env, OBSIDIAN_E2E_CDP_PORT: port };
	} catch {
		throw new Error(
			"This worktree's Obsidian instance is not running: npm run start:e2e-obsidian",
		);
	}
}

/** @param {string[]} argv */
async function startPrintEnv(argv) {
	let printed = "";
	const code = await runObsidianE2ECli(argv, {
		...runnerDeps,
		stdout: (text) => {
			printed += text;
			process.stdout.write(text);
		},
	});
	const home = /^export OBSIDIAN_E2E_OBSIDIAN_HOME=(.+)$/m.exec(printed)?.[1];
	if (code === 0 && home) process.stdout.write(`export XDG_RUNTIME_DIR=${home}\n`);
	return code;
}

/**
 * Run tests/e2e against this worktree's instance. On Linux the instance is
 * started (or reused and reloaded) first, and stopped afterwards only when this
 * run launched it.
 * @param {string[]} args Vitest arguments.
 */
async function runTests(args) {
	const instance = linux ? await defaultInstance() : undefined;
	const wasRunning = !instance || (await isInstanceReady(instance));
	const results = path.join(os.tmpdir(), `podnotes-e2e-${process.pid}.json`);
	/** @type {NodeJS.Signals | undefined} */
	let interrupted;
	/** @param {NodeJS.Signals} signal */
	const onSignal = (signal) => {
		interrupted ??= signal;
	};
	process.on("SIGINT", onSignal);
	process.on("SIGTERM", onSignal);
	try {
		if (instance) {
			const started = await runObsidianE2ECli(["start"], runnerDeps);
			if (started !== 0) return started;
		}
		if (interrupted) return 128 + os.constants.signals[interrupted];
		const child = spawn(
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
				stdio: "inherit",
				env: instance
					? {
							...process.env,
							OBSIDIAN_E2E_VAULT: instance.vaultName,
							OBSIDIAN_E2E_VAULT_PATH: instance.vaultPath,
							OBSIDIAN_E2E_OBSIDIAN_HOME: instance.obsidianHome,
						}
					: process.env,
			},
		);
		const [code, signal] = await once(child, "close");
		if (signal) return 128 + os.constants.signals[/** @type {NodeJS.Signals} */ (signal)];
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
		process.off("SIGINT", onSignal);
		process.off("SIGTERM", onSignal);
		await fsp.rm(results, { force: true });
		if (!wasRunning) await runObsidianE2ECli(["stop"], runnerDeps);
	}
}

/**
 * `screenshot <out.png>` and `record <out.mp4|webm> [-- driver...]` capture the
 * PodNotes player; `capture ...` is upstream `capture` against this instance.
 * @param {"screenshot" | "record" | "capture"} verb
 * @param {string[]} args
 */
async function capture(verb, args) {
	if (!linux) {
		throw new Error(`${verb} is Linux-only; on macOS use \`npx obsidian-e2e capture launch\`.`);
	}
	if (verb === "capture") return runObsidianE2ECli(["capture", ...args], { env: await cdpEnv() });
	const [output, separator, ...driver] = args;
	const usable =
		verb === "screenshot"
			? output && args.length === 1
			: output && (args.length === 1 || (separator === "--" && driver.length > 0));
	if (!usable) {
		throw new Error(
			verb === "screenshot"
				? "Usage: screenshot <out.png>"
				: "Usage: record <out.mp4|out.webm> [-- <driver command...>]",
		);
	}
	const opened = await runObsidianE2ECli(["run", "eval", `code=${OPEN_PLAYER}`], runnerDeps);
	if (opened !== 0) return opened;
	await fsp.mkdir(path.dirname(path.resolve(output)), { recursive: true });
	// x11 takes start a few encoder frames before upstream's start estimate and
	// are rejected once that exceeds 0.5 s; at 30 fps those frames stay well under.
	const captureArgs =
		verb === "screenshot"
			? ["screenshot", output, "--selector", PLAYER_SELECTOR]
			: [
					"record",
					output,
					"--fps",
					"30",
					"--",
					...(driver.length > 0 ? driver : ["sleep", "3"]),
				];
	return runObsidianE2ECli(["capture", ...captureArgs], { env: await cdpEnv() });
}

/** @param {string[]} argv */
function main(argv) {
	const [verb, ...rest] = argv;
	switch (verb) {
		case "test":
			return runTests(rest);
		case "screenshot":
		case "record":
		case "capture":
			return capture(verb, rest);
		case "start":
			if (linux && rest.includes("--print-env")) return startPrintEnv(argv);
	}
	return runObsidianE2ECli(argv, runnerDeps);
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
