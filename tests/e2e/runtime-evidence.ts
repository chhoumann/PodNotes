import fs from "node:fs/promises";
import path from "node:path";
import type { ObsidianClient } from "obsidian-e2e";
import { runAllSteps, jsLiteral } from "./runtime";

const RECORDER_ID = /^podnotes-e2e-errors-\d+$/;
const RECORDER_NAME = "PodNotes E2E error recorder";
const INSTALL_FILES = new Set(["errors.jsonl", "main.js", "manifest.json.tmp", "manifest.json"]);

type Evidence = {
	id: string;
	directory: string;
	journal: string;
	configPath: string;
	configBytes: Buffer | null;
	enabled: readonly string[];
	cursor: number;
	pending: string[];
};

let owner: Evidence | undefined;

export async function installRuntimeEvidence(obsidian: ObsidianClient): Promise<void> {
	if (owner) throw new Error("Runtime evidence is already installed in this process.");
	const vault = await obsidian.vaultPath();
	const plugins = path.join(vault, ".obsidian", "plugins");
	const configPath = path.join(vault, ".obsidian", "community-plugins.json");
	await removeStaleRecorders(obsidian, plugins, configPath);
	const configBytes = await readOptional(configPath);
	const enabled = await obsidian.dev.evalJson<string[]>("[...app.plugins.enabledPlugins]");
	const id = `podnotes-e2e-errors-${process.pid}`;
	const directory = path.join(plugins, id);
	const journal = path.join(directory, "errors.jsonl");
	owner = { id, directory, journal, configPath, configBytes, enabled, cursor: 0, pending: [] };
	await fs.mkdir(directory);
	await fs.writeFile(journal, "");
	await fs.writeFile(
		path.join(directory, "main.js"),
		`const fs = require("fs");
const { Notice, Plugin } = require("obsidian");
module.exports = class extends Plugin {
	onload() {
		const setAutoHide = Notice.prototype.setAutoHide;
		Notice.prototype.setAutoHide = function(duration) {
			this.containerEl.dataset.podnotesE2ePersistent = String(duration === 0);
			return setAutoHide.call(this, duration);
		};
		this.register(() => { Notice.prototype.setAutoHide = setAutoHide; });
		// Obsidian creates its persistent keyring warning before community plugins load.
		for (const notice of document.querySelectorAll(".notice")) {
			if (notice.querySelector(".notice-message")?.textContent === "Secrets are stored without encryption because no secret store is available on this system.") {
				notice.dataset.podnotesE2ePersistent = "true";
				notice.dataset.podnotesE2eKeyring = "true";
			}
		}
		const record = (source, reason) => {
			try {
				const stack = reason?.stack === undefined ? undefined : String(reason.stack);
				fs.appendFileSync(${jsLiteral(journal)}, JSON.stringify({ source, message: String(reason?.message ?? reason), stack }) + "\\n");
			} catch (error) {
				// Kept outside the renderer, which a reload or restart can replace before the harness reads it.
				if (localStorage.getItem(${jsLiteral(failureKey(id))}) === null)
					localStorage.setItem(${jsLiteral(failureKey(id))}, "The error journal could not be written: " + String(error));
			}
		};
		this.registerDomEvent(window, "error", (event) => record("error", event.error ?? event.message));
		this.registerDomEvent(window, "unhandledrejection", (event) => record("unhandledrejection", event.reason));
	}
};
`,
	);
	// Published last and atomically, so Obsidian never reads a partial manifest.
	await fs.writeFile(path.join(directory, "manifest.json.tmp"), recorderManifest(id));
	await fs.rename(
		path.join(directory, "manifest.json.tmp"),
		path.join(directory, "manifest.json"),
	);
	// Obsidian loads plugins in this order, so the recorder starts before PodNotes.
	await obsidian.dev.evalJsonAsync(`(async () => {
		localStorage.removeItem(${jsLiteral(failureKey(id))});
		await app.plugins.loadManifests();
		await app.plugins.enablePlugin(${jsLiteral(id)});
		app.plugins.enabledPlugins = new Set(${jsLiteral([id, ...enabled])});
		await app.plugins.saveConfig();
		return true;
	})()`);
}

/** `ignored` is one error message to accept here, and only an error with exactly that message. */
export async function collectRuntimeErrors(
	obsidian: ObsidianClient,
	ignored?: string,
): Promise<void> {
	const evidence = owner;
	if (!evidence) return;
	await collect(obsidian, evidence, ignored);
	await readRecorder(obsidian, evidence);
	await readJournal(evidence, ignored);
}

async function collect(
	obsidian: ObsidianClient,
	evidence: Evidence,
	ignored?: string,
): Promise<void> {
	try {
		const errors = (await obsidian.dev.runtimeErrors()).filter(
			({ message }) => message !== ignored,
		);
		if (errors.length) evidence.pending.push(`obsidian-e2e: ${JSON.stringify(errors)}`);
		await obsidian.dev.resetDiagnostics();
	} catch (error) {
		evidence.pending.push(`obsidian-e2e errors could not be read: ${String(error)}`);
	}
	try {
		const { stdout } = await obsidian.exec("dev:errors");
		// The CLI separates "<time> <message>[\n<stack>]" entries with a blank line.
		const errors = stdout
			.trim()
			.split("\n\n")
			.filter(
				(entry) =>
					entry !== "No errors captured." &&
					entry.slice(entry.indexOf(" ") + 1) !== ignored,
			);
		if (errors.length) evidence.pending.push(`Obsidian CLI: ${errors.join("\n\n")}`);
		await obsidian.exec("dev:errors", { clear: true });
	} catch (error) {
		evidence.pending.push(`Obsidian CLI errors could not be read: ${String(error)}`);
	}
}

export async function assertNoNewRuntimeErrors(
	obsidian: ObsidianClient,
	raised = "since the previous check",
): Promise<void> {
	const evidence = owner;
	if (!evidence) throw new Error("Runtime evidence is not installed.");
	await collect(obsidian, evidence);
	await readRecorder(obsidian, evidence);
	await readJournal(evidence);
	reportPending(evidence, raised);
}

export async function closeRuntimeEvidence(obsidian: ObsidianClient): Promise<void> {
	const evidence = owner;
	if (!evidence) return;
	owner = undefined;
	await collect(obsidian, evidence);
	await readRecorder(obsidian, evidence);
	await runAllSteps(
		async () => {
			const failure = await obsidian.dev.evalJsonAsync<string | null>(`(async () => {
				await app.plugins.disablePlugin(${jsLiteral(evidence.id)});
				const failure = localStorage.getItem(${jsLiteral(failureKey(evidence.id))});
				localStorage.removeItem(${jsLiteral(failureKey(evidence.id))});
				app.plugins.enabledPlugins = new Set(${jsLiteral(evidence.enabled)});
				app.plugins.requestSaveConfig.cancel();
				await app.plugins.saveConfig();
				app.plugins.requestSaveConfig.cancel();
				await app.vault.adapter.promise;
				return failure;
			})()`);
			if (failure) evidence.pending.push(failure);
		},
		async () => {
			if (evidence.configBytes === null) await fs.rm(evidence.configPath, { force: true });
			else await fs.writeFile(evidence.configPath, evidence.configBytes);
		},
		async () => {
			await collect(obsidian, evidence);
			await readJournal(evidence);
			reportPending(evidence, "during the suite's final cleanup");
		},
		() => fs.rm(evidence.directory, { recursive: true, force: true }),
		() =>
			obsidian.dev.evalJsonAsync(
				"(async () => { await app.plugins.loadManifests(); return true; })()",
			),
	);
}

async function readRecorder(obsidian: ObsidianClient, evidence: Evidence): Promise<void> {
	try {
		const failures = await obsidian.dev.evalJson<string[]>(`(() => {
			const failure = localStorage.getItem(${jsLiteral(failureKey(evidence.id))});
			localStorage.removeItem(${jsLiteral(failureKey(evidence.id))});
			const loaded = Boolean(app.plugins.plugins[${jsLiteral(evidence.id)}]);
			return [loaded ? null : "The error recorder is not loaded.", failure].filter(Boolean);
		})()`);
		evidence.pending.push(...failures);
	} catch (error) {
		evidence.pending.push(`The error recorder could not be read: ${String(error)}`);
	}
}

async function readJournal(evidence: Evidence, ignored?: string): Promise<void> {
	try {
		const bytes = await fs.readFile(evidence.journal);
		const end = bytes.lastIndexOf(0x0a) + 1;
		if (end <= evidence.cursor) return;
		const lines = bytes.subarray(evidence.cursor, end).toString("utf8").split("\n");
		evidence.cursor = end;
		for (const line of lines)
			if (line && !(ignored !== undefined && journalMessage(line) === ignored))
				evidence.pending.push(`window ${line}`);
	} catch (error) {
		evidence.pending.push(`The error journal could not be read: ${String(error)}`);
	}
}

function reportPending(evidence: Evidence, raised: string): void {
	const errors = evidence.pending.splice(0);
	if (errors.length) throw new Error(`Runtime errors ${raised}:\n${errors.join("\n")}`);
}

async function removeStaleRecorders(
	obsidian: ObsidianClient,
	plugins: string,
	configPath: string,
): Promise<void> {
	const folders = (
		await fs.readdir(plugins).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
			return [];
		})
	).filter((name) => RECORDER_ID.test(name));
	const configBytes = await readOptional(configPath);
	const persisted: unknown = configBytes === null ? [] : JSON.parse(configBytes.toString("utf8"));
	if (!Array.isArray(persisted)) throw new Error(`${configPath} is not a list of plugin ids.`);
	const runtime = await obsidian.dev.evalJson<string[]>(
		"[...new Set([...app.plugins.enabledPlugins, ...Object.keys(app.plugins.plugins)])]",
	);
	const stale = [...new Set([...folders, ...persisted, ...runtime])].filter(
		(id): id is string => typeof id === "string" && RECORDER_ID.test(id),
	);
	if (!stale.length) return;
	for (const folder of folders)
		if (!(await isRecorderFolder(path.join(plugins, folder), folder)))
			throw new Error(
				`Refusing to remove ${path.join(plugins, folder)}: it is not a PodNotes e2e error recorder.`,
			);
	await obsidian.dev.evalJsonAsync(`(async () => {
		const stale = new Set(${jsLiteral(stale)});
		for (const id of stale) {
			await app.plugins.disablePlugin(id);
			localStorage.removeItem(id + ":journal-failure");
		}
		app.plugins.enabledPlugins = new Set([...app.plugins.enabledPlugins].filter((id) => !stale.has(id)));
		app.plugins.requestSaveConfig.cancel();
		await app.vault.adapter.promise;
		return true;
	})()`);
	if (persisted.some((id) => stale.includes(id)))
		await fs.writeFile(
			configPath,
			JSON.stringify(
				persisted.filter((id) => !stale.includes(id)),
				null,
				2,
			),
		);
	for (const folder of folders)
		await fs.rm(path.join(plugins, folder), { recursive: true, force: true });
	await obsidian.dev.evalJsonAsync(
		"(async () => { await app.plugins.loadManifests(); return true; })()",
	);
}

async function isRecorderFolder(directory: string, id: string): Promise<boolean> {
	const manifest = await readOptional(path.join(directory, "manifest.json"));
	const identity = manifest === null ? undefined : parseJson(manifest.toString("utf8"));
	if (identity !== undefined)
		return (
			typeof identity === "object" &&
			identity !== null &&
			"id" in identity &&
			identity.id === id &&
			"name" in identity &&
			identity.name === RECORDER_NAME
		);
	// An install interrupted before it finished leaves no manifest or a prefix of its own.
	const expected = Buffer.from(recorderManifest(id));
	return (
		(manifest === null || expected.subarray(0, manifest.length).equals(manifest)) &&
		(await fs.readdir(directory)).every((name) => INSTALL_FILES.has(name))
	);
}

function recorderManifest(id: string): string {
	return JSON.stringify({
		id,
		name: RECORDER_NAME,
		version: "1.0.0",
		minAppVersion: "1.13.0",
		description: "Journal uncaught renderer errors for the PodNotes e2e suite.",
		author: "PodNotes tests",
	});
}

function failureKey(id: string): string {
	return `${id}:journal-failure`;
}

function journalMessage(line: string): unknown {
	const entry = parseJson(line);
	return typeof entry === "object" && entry !== null && "message" in entry
		? entry.message
		: undefined;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

async function readOptional(filePath: string): Promise<Buffer | null> {
	return await fs.readFile(filePath).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
		return null;
	});
}
