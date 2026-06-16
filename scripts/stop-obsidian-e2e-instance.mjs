#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { resolveInstanceOptions } from "./start-obsidian-e2e-instance.mjs";

const execFileAsync = promisify(execFile);

// Window we give a SIGTERM'd Obsidian tree to exit cleanly before escalating to
// SIGKILL. Electron tears down its helper processes in well under a second.
const TERM_GRACE_MS = 3_000;
const TERM_POLL_MS = 100;

// Every per-worktree instance dir is `<profile-root>/<vaultName>-<12 hex>` (see
// stableInstanceId in start-obsidian-e2e-instance.mjs). The trailing hash makes
// the dir name globally unique and is the guard that stops us ever removing a
// non-instance directory (the shared dev vault, a quickadd profile, `/tmp`, …).
const INSTANCE_DIR_PATTERN = /-[0-9a-f]{12}$/;

const VALUE_OPTIONS = new Set([
	"--vault",
	"--root",
	"--worktree",
	"--data",
	"--profile-root",
	"--obsidian-app",
	"--obsidian-bin",
]);

function printUsage() {
	console.log(`Usage: node scripts/stop-obsidian-e2e-instance.mjs [options]

Stops the worktree-local Obsidian E2E instance: it finds the Obsidian process
tree bound to this worktree's private HOME / --user-data-dir, terminates it, and
removes the instance's /tmp profile directory. It never touches the shared dev
vault, other worktrees, or quickadd instances.

Options:
  --vault <name>        Vault/profile name. Defaults to podnotes-<worktree>.
  --root <path>         Directory that contains provisioned vaults. Defaults to .obsidian-e2e-vaults.
  --worktree <path>     PodNotes worktree the instance belongs to. Defaults to cwd.
  --profile-root <path> Directory for per-vault Obsidian HOME profiles. Defaults to /tmp/podnotes-obsidian-e2e.
  --prune               Also reap orphaned instances whose backing vault is gone.
  --dry-run             Report what would be stopped/removed without doing it.
  --json                Print a machine-readable summary.
  --help                Show this help.
`);
}

export function parseArgs(argv) {
	const options = { dryRun: false, json: false, prune: false };

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--":
				break;
			case "--dry-run":
				options.dryRun = true;
				break;
			case "--prune":
				options.prune = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--help":
				options.help = true;
				break;
			default: {
				if (!VALUE_OPTIONS.has(arg)) {
					throw new Error(`Unknown option: ${arg}`);
				}
				const value = argv[index + 1];
				if (!value || value.startsWith("--")) {
					throw new Error(`${arg} requires a value.`);
				}
				options[toOptionKey(arg)] = value;
				index += 1;
			}
		}
	}

	return options;
}

function toOptionKey(arg) {
	if (arg === "--profile-root") return "profileRoot";
	if (arg === "--obsidian-app") return "obsidianApp";
	if (arg === "--obsidian-bin") return "obsidianBin";
	return arg.slice(2);
}

// macOS firmlinks /tmp, /var, and /etc under /private. Obsidian's main process
// keeps the literal `--user-data-dir` we pass (e.g. /tmp/...), while Electron
// canonicalizes the same flag to /private/tmp/... for its helper processes.
// Strip a leading /private so one instance path matches the whole process tree.
function stripPrivatePrefix(value) {
	return value.replace(/^\/private(?=\/)/, "");
}

export function commandMatchesInstance(command, instancePath) {
	const stripped = stripPrivatePrefix(instancePath);
	const variants = new Set([
		instancePath,
		stripped,
		stripped.replace(/^\//, "/private/"),
	]);
	// Every real reference is a directory prefix (e.g. --user-data-dir=<path>/home/…),
	// so require a trailing separator: it avoids matching a sibling instance whose
	// id merely shares this one as a leading string.
	return [...variants].some((variant) => command.includes(`${variant}/`));
}

export function parsePsOutput(stdout) {
	const processes = [];
	for (const line of stdout.split("\n")) {
		const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/);
		if (!match) continue;
		processes.push({
			pid: Number(match[1]),
			ppid: Number(match[2]),
			command: match[3],
		});
	}
	return processes;
}

// Returns the pids of the Obsidian process tree bound to `instancePath`: the
// seed processes whose argv references the instance profile, plus every
// descendant. The descendant walk is belt-and-suspenders — Electron helpers
// already carry --user-data-dir, but this also reaps any grandchild a helper
// spawned that does not echo the flag.
export function collectInstancePids(processes, instancePath, options = {}) {
	const selfPid = options.selfPid ?? process.pid;
	const childrenByParent = new Map();
	for (const proc of processes) {
		const siblings = childrenByParent.get(proc.ppid) ?? [];
		siblings.push(proc);
		childrenByParent.set(proc.ppid, siblings);
	}

	const collected = new Set();
	const stack = processes
		.filter((proc) => commandMatchesInstance(proc.command, instancePath))
		.map((proc) => proc.pid);
	while (stack.length > 0) {
		const pid = stack.pop();
		if (collected.has(pid)) continue;
		collected.add(pid);
		for (const child of childrenByParent.get(pid) ?? []) {
			stack.push(child.pid);
		}
	}

	// Never signal ourselves, init, or the kernel — defensive, the token would
	// not match these anyway.
	for (const guarded of [selfPid, 0, 1]) collected.delete(guarded);
	return [...collected].sort((a, b) => a - b);
}

function assertSafeInstancePath(instancePath) {
	if (!instancePath || !path.isAbsolute(instancePath)) {
		throw new Error(
			`Refusing to remove non-absolute instance path: ${instancePath}`,
		);
	}
	const base = path.basename(instancePath);
	if (!INSTANCE_DIR_PATTERN.test(base)) {
		throw new Error(
			`Refusing to remove ${instancePath}: not an Obsidian E2E instance directory.`,
		);
	}
	// A real instance dir is several levels deep (e.g. /tmp/podnotes-obsidian-e2e/<id>);
	// reject anything shallow enough to be a system root.
	if (instancePath.split(path.sep).filter(Boolean).length < 2) {
		throw new Error(`Refusing to remove shallow path: ${instancePath}`);
	}
}

async function defaultRunPs() {
	const { stdout } = await execFileAsync(
		"ps",
		["-axww", "-o", "pid=,ppid=,command="],
		{ maxBuffer: 16 * 1024 * 1024 },
	);
	return stdout;
}

function pidAlive(pid, kill) {
	try {
		kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but is owned by someone else; for our own
		// instances that should not happen, but treat it as alive to be safe.
		return error?.code === "EPERM";
	}
}

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalPids(pids, signal, kill) {
	const signalled = [];
	for (const pid of pids) {
		try {
			kill(pid, signal);
			signalled.push(pid);
		} catch (error) {
			// ESRCH: the process already exited between discovery and signalling.
			if (error?.code !== "ESRCH") throw error;
		}
	}
	return signalled;
}

// Stop a single instance: terminate its process tree (SIGTERM, then SIGKILL for
// stragglers) and remove its profile directory. Safe to call when nothing is
// running — it then just removes a leftover directory. All side effects are
// injectable so the orchestration is unit-testable without real processes.
export async function stopInstance(instancePath, options = {}) {
	const {
		dryRun = false,
		kill = process.kill.bind(process),
		runPs = defaultRunPs,
		removeDir = (dir) => fs.rm(dir, { recursive: true, force: true }),
		selfPid = process.pid,
		graceMs = TERM_GRACE_MS,
		pollMs = TERM_POLL_MS,
	} = options;

	assertSafeInstancePath(instancePath);

	const processes = parsePsOutput(await runPs());
	const pids = collectInstancePids(processes, instancePath, { selfPid });

	if (dryRun) {
		return { instancePath, pids, terminated: [], killed: [], removed: false };
	}

	signalPids(pids, "SIGTERM", kill);

	let survivors = pids;
	const deadline = monotonicNow() + graceMs;
	while (survivors.length > 0 && monotonicNow() < deadline) {
		await sleep(pollMs);
		survivors = survivors.filter((pid) => pidAlive(pid, kill));
	}
	const killed =
		survivors.length > 0 ? signalPids(survivors, "SIGKILL", kill) : [];

	await removeDir(instancePath);

	return { instancePath, pids, terminated: pids, killed, removed: true };
}

// Reads the vault paths an instance registered in its private obsidian.json.
// Returns null when the registration is unreadable (so callers can stay
// conservative and not reap an instance they cannot reason about).
export async function readInstanceVaultPaths(instancePath, deps = {}) {
	const readFile = deps.readFile ?? ((file) => fs.readFile(file, "utf8"));
	const jsonPath = path.join(
		instancePath,
		"home",
		"Library",
		"Application Support",
		"obsidian",
		"obsidian.json",
	);
	try {
		const parsed = JSON.parse(await readFile(jsonPath));
		return Object.values(parsed?.vaults ?? {})
			.map((vault) => vault?.path)
			.filter((vaultPath) => typeof vaultPath === "string");
	} catch {
		return null;
	}
}

async function pathExists(target) {
	try {
		await fs.lstat(target);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

// An instance is "orphaned" once every vault it was created for is gone from
// disk — the signature of a worktree that was removed on merge. We deliberately
// do NOT treat "no process running" as orphaned: an idle-but-valid instance for
// a live worktree must survive so a concurrent worker can reuse it.
export async function isInstanceOrphaned(instancePath, deps = {}) {
	const exists = deps.exists ?? pathExists;
	const vaultPaths = await readInstanceVaultPaths(instancePath, deps);
	if (vaultPaths === null || vaultPaths.length === 0) return false;
	for (const vaultPath of vaultPaths) {
		if (await exists(vaultPath)) return false;
	}
	return true;
}

// Scans the profile root and tears down every orphaned instance. Used as a
// self-healing safety net on the next `start:e2e-obsidian` so leaks survive even
// when a worktree is removed without the orca archive hook (`--run-hooks`).
export async function reapOrphanedInstances(options = {}) {
	const {
		profileRoot,
		exceptInstancePath,
		dryRun = false,
		log = () => {},
		readdir = (dir) => fs.readdir(dir, { withFileTypes: true }),
		...deps
	} = options;

	if (!profileRoot) return { scanned: 0, reaped: [] };

	let entries;
	try {
		entries = await readdir(profileRoot);
	} catch (error) {
		if (error?.code === "ENOENT") return { scanned: 0, reaped: [] };
		throw error;
	}

	const reaped = [];
	let scanned = 0;
	const except = exceptInstancePath ? path.resolve(exceptInstancePath) : null;
	for (const entry of entries) {
		if (!entry.isDirectory() || !INSTANCE_DIR_PATTERN.test(entry.name))
			continue;
		const instancePath = path.join(profileRoot, entry.name);
		if (except && path.resolve(instancePath) === except) continue;
		scanned += 1;
		if (!(await isInstanceOrphaned(instancePath, deps))) continue;
		log(`Reaping orphaned E2E instance ${entry.name} (backing vault is gone).`);
		if (!dryRun) await stopInstance(instancePath, { ...deps, dryRun: false });
		reaped.push(instancePath);
	}

	return { scanned, reaped };
}

// setTimeout-based polling needs a monotonic clock; Date.now is adequate here and
// keeps the helper trivially mockable in tests via the injected clock.
function monotonicNow() {
	return Date.now();
}

async function main() {
	const rawOptions = parseArgs(process.argv.slice(2));
	if (rawOptions.help) {
		printUsage();
		return;
	}

	const options = resolveInstanceOptions(rawOptions);
	const summary = await stopInstance(options.instancePath, {
		dryRun: rawOptions.dryRun,
	});

	let pruneResult = { scanned: 0, reaped: [] };
	if (rawOptions.prune) {
		pruneResult = await reapOrphanedInstances({
			profileRoot: options.profileRoot,
			exceptInstancePath: options.instancePath,
			dryRun: rawOptions.dryRun,
			log: rawOptions.json ? () => {} : console.error,
		});
	}

	const result = {
		...summary,
		vaultName: options.vaultName,
		prune: pruneResult,
	};
	if (rawOptions.json) {
		console.log(JSON.stringify(result, null, 2));
		return;
	}

	const verb = rawOptions.dryRun ? "Would stop" : "Stopped";
	console.log(`${verb} Obsidian E2E instance ${options.vaultName}`);
	console.log(`Instance dir: ${options.instancePath}`);
	console.log(
		summary.pids.length > 0
			? `Process tree: ${summary.pids.join(", ")}`
			: "Process tree: none running",
	);
	if (rawOptions.prune && pruneResult.reaped.length > 0) {
		console.log(`Reaped ${pruneResult.reaped.length} orphaned instance(s).`);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
