import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { open } from "node:fs/promises";
import { promisify } from "node:util";
import { ensureObsidianInstance, launchObsidianInstance } from "obsidian-e2e/runner";

export const FIXTURE_HOST = "podnotes.test";
export const SUPERCAST_FIXTURE_HOST = "priv3.supercast.com";
export const FIXTURE_RESOLVER_RULES = `MAP ${FIXTURE_HOST} 127.0.0.1,MAP ${SUPERCAST_FIXTURE_HOST} 127.0.0.1`;
const resolverFlag = `--host-resolver-rules=${FIXTURE_RESOLVER_RULES}`;
const exec = promisify(execFile);

/** @type {import("obsidian-e2e/runner").SpawnDetachedFn} */
const spawnLogged = async (file, args, { env, cwd, logPath }) => {
	const log = await open(logPath, "a", 0o600);
	try {
		const child = spawn(file, [...args], {
			env,
			cwd,
			detached: true,
			stdio: ["ignore", log.fd, log.fd],
		});
		await once(child, "spawn");
		child.unref();
	} finally {
		await log.close();
	}
};

/**
 * @param {import("obsidian-e2e/runner").LaunchTarget} target
 * @param {import("obsidian-e2e/runner").ObsidianExecDependencies} [deps]
 */
export function launchPodNotesInstance(target, deps = {}) {
	return launchObsidianInstance(target, {
		...deps,
		execFile: (file, args, options) =>
			(deps.execFile ?? exec)(file, [...args, resolverFlag], {
				encoding: "utf8",
				...options,
			}),
		spawnDetached: (file, args, options) =>
			(deps.spawnDetached ?? spawnLogged)(file, [...args, resolverFlag], options),
	});
}

/** @param {() => void} [onLaunch] @returns {import("obsidian-e2e/runner").CliDependencies} */
export function podNotesRunnerDependencies(onLaunch = () => {}) {
	return {
		reapOrphanedInstances: async () => ({ reaped: [], scanned: 0 }),
		ensureObsidianInstance: (options, config, deps) =>
			ensureObsidianInstance(options, config, {
				...deps,
				launchObsidianInstance: async (target, execDeps) => {
					onLaunch();
					await launchPodNotesInstance(target, execDeps);
				},
			}),
	};
}
