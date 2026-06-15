#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// PodNotes bundles its CSS into main.js (svelte compilerOptions css: "injected"),
// so there is no styles.css artifact to symlink — only the manifest and bundle.
const REQUIRED_PLUGIN_FILES = ["manifest.json", "main.js"];
const DEFAULT_ROOT = ".obsidian-e2e-vaults";
const DEFAULT_VAULT_PREFIX = "podnotes";
const PLUGIN_ID = "podnotes";

// Expression evaluated via `obsidian eval` to confirm the PodNotes plugin
// instance is live in the target vault (the launcher waits for stdout to
// contain "=> true"). The expression intentionally does not contain the literal
// "=> true" so an echoed command can't be mistaken for a positive result.
export const PODNOTES_READY_EVAL = `Boolean(app.plugins.plugins[${JSON.stringify(PLUGIN_ID)}])`;

// A valid, empty PodNotes settings document. Mirrors DEFAULT_SETTINGS in
// src/constants.ts so a freshly provisioned vault loads with clean state instead
// of QuickAdd's { choices, migrations } shape. Keep in sync with constants.ts.
// (currentEpisode is intentionally omitted — DEFAULT_SETTINGS sets it to
// undefined, which JSON cannot represent and PodNotes treats as absent.)
export const DEFAULT_PODNOTES_DATA = {
	savedFeeds: {},
	podNotes: {},
	defaultPlaybackRate: 1,
	defaultVolume: 1,
	hidePlayedEpisodes: false,
	playedEpisodes: {},
	favorites: {
		icon: "lucide-star",
		name: "Favorites",
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
		episodes: [],
	},
	queue: {
		icon: "list-ordered",
		name: "Queue",
		shouldEpisodeRemoveAfterPlay: true,
		shouldRepeat: false,
		episodes: [],
	},
	playlists: {},
	skipBackwardLength: 15,
	skipForwardLength: 15,
	timestamp: {
		template: "- {{time}} ",
		offset: 0,
	},
	note: {
		path: "",
		template: "",
	},
	download: {
		path: "",
	},
	downloadedEpisodes: {},
	localFiles: {
		icon: "folder",
		name: "Local Files",
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
		episodes: [],
	},
	openAIApiKey: "",
	transcript: {
		path: "transcripts/{{podcast}}/{{title}}.md",
		template:
			"# {{title}}\n\nPodcast: {{podcast}}\nDate: {{date}}\n\n{{transcript}}",
	},
	feedCache: {
		enabled: true,
		ttlHours: 6,
	},
};

function slugify(value) {
	return (
		value
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "worktree"
	);
}

function printUsage() {
	console.log(`Usage: node scripts/provision-obsidian-e2e-vault.mjs [options]

Options:
  --vault <name>        Vault name to provision. Defaults to podnotes-<worktree>.
  --root <path>         Directory that contains provisioned vaults. Defaults to .obsidian-e2e-vaults.
  --worktree <path>     PodNotes worktree to link plugin files from. Defaults to cwd.
  --data <path>         Optional PodNotes data.json seed to copy on first provision.
  --force               Recreate plugin symlinks if they already exist.
  --print-env           Print PODNOTES_E2E_VAULT exports after provisioning.
  --json                Print a machine-readable summary after provisioning.
  --help                Show this help.
`);
}

export function parseArgs(argv) {
	const options = {
		force: false,
		json: false,
		printEnv: false,
	};

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		switch (arg) {
			case "--":
				break;
			case "--force":
				options.force = true;
				break;
			case "--json":
				options.json = true;
				break;
			case "--print-env":
				options.printEnv = true;
				break;
			case "--help":
				options.help = true;
				break;
			case "--vault":
			case "--root":
			case "--worktree":
			case "--data": {
				const value = argv[index + 1];
				if (!value || value.startsWith("--")) {
					throw new Error(`${arg} requires a value.`);
				}
				options[toOptionKey(arg)] = value;
				index += 1;
				break;
			}
			default:
				throw new Error(`Unknown option: ${arg}`);
		}
	}

	return options;
}

function toOptionKey(arg) {
	return arg.slice(2);
}

export function resolveProvisionOptions(rawOptions, cwd = process.cwd()) {
	const worktreePath = path.resolve(cwd, rawOptions.worktree ?? ".");
	const vaultName =
		rawOptions.vault ??
		`${DEFAULT_VAULT_PREFIX}-${slugify(path.basename(worktreePath))}`;
	const rootPath = path.resolve(cwd, rawOptions.root ?? DEFAULT_ROOT);
	const vaultPath = path.resolve(rootPath, vaultName);
	const dataPath = rawOptions.data
		? path.resolve(cwd, rawOptions.data)
		: undefined;

	return {
		dataPath,
		force: rawOptions.force ?? false,
		json: rawOptions.json ?? false,
		printEnv: rawOptions.printEnv ?? false,
		rootPath,
		vaultName,
		vaultPath,
		worktreePath,
	};
}

async function pathExists(filePath) {
	try {
		await fs.lstat(filePath);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

async function assertRequiredPluginFiles(worktreePath) {
	const missing = [];
	for (const fileName of REQUIRED_PLUGIN_FILES) {
		const filePath = path.join(worktreePath, fileName);
		if (!(await pathExists(filePath))) missing.push(fileName);
	}

	if (missing.length > 0) {
		throw new Error(
			[
				`Cannot provision PodNotes in ${worktreePath}; missing ${missing.join(", ")}.`,
				"Run npm run build in that worktree before provisioning.",
			].join(" "),
		);
	}
}

async function writeJson(filePath, value) {
	await fs.mkdir(path.dirname(filePath), { recursive: true });
	await fs.writeFile(
		`${filePath}.tmp`,
		`${JSON.stringify(value, null, "\t")}\n`,
	);
	await fs.rename(`${filePath}.tmp`, filePath);
}

async function writeJsonIfMissing(filePath, value) {
	if (await pathExists(filePath)) return;
	await writeJson(filePath, value);
}

async function linkPluginFile(sourcePath, destinationPath, force) {
	const existing = await pathExists(destinationPath);
	if (existing && force) {
		await fs.unlink(destinationPath);
	} else if (existing) {
		const stat = await fs.lstat(destinationPath);
		if (!stat.isSymbolicLink()) {
			throw new Error(
				`${destinationPath} exists and is not a symlink. Use --force after reviewing it.`,
			);
		}

		const currentTarget = await fs.readlink(destinationPath);
		if (
			path.resolve(path.dirname(destinationPath), currentTarget) === sourcePath
		) {
			return;
		}

		throw new Error(
			`${destinationPath} points at ${currentTarget}. Use --force to relink it.`,
		);
	}

	await fs.symlink(sourcePath, destinationPath);
}

export async function provisionVault(options) {
	await assertRequiredPluginFiles(options.worktreePath);

	const obsidianPath = path.join(options.vaultPath, ".obsidian");
	const pluginPath = path.join(obsidianPath, "plugins", PLUGIN_ID);

	await fs.mkdir(pluginPath, { recursive: true });
	await writeJsonIfMissing(path.join(obsidianPath, "app.json"), {});
	await writeJsonIfMissing(path.join(obsidianPath, "appearance.json"), {});
	await writeJsonIfMissing(path.join(obsidianPath, "core-plugins.json"), []);
	await writeJson(path.join(obsidianPath, "community-plugins.json"), [
		PLUGIN_ID,
	]);
	await writeJsonIfMissing(path.join(obsidianPath, "workspace.json"), {
		main: { id: "podnotes-e2e", type: "split", children: [] },
		left: { id: "podnotes-e2e-left", type: "split", children: [] },
		right: { id: "podnotes-e2e-right", type: "split", children: [] },
	});

	for (const fileName of REQUIRED_PLUGIN_FILES) {
		await linkPluginFile(
			path.join(options.worktreePath, fileName),
			path.join(pluginPath, fileName),
			options.force,
		);
	}

	const pluginDataPath = path.join(pluginPath, "data.json");
	if (options.dataPath && !(await pathExists(pluginDataPath))) {
		await fs.copyFile(options.dataPath, pluginDataPath);
	} else {
		await writeJsonIfMissing(pluginDataPath, DEFAULT_PODNOTES_DATA);
	}

	return {
		pluginPath,
		vaultName: options.vaultName,
		vaultPath: options.vaultPath,
		worktreePath: options.worktreePath,
	};
}

export function toShellExports(result) {
	return [
		`export PODNOTES_E2E_VAULT=${shellQuote(result.vaultName)}`,
		`export PODNOTES_E2E_VAULT_PATH=${shellQuote(result.vaultPath)}`,
	].join("\n");
}

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

async function main() {
	const rawOptions = parseArgs(process.argv.slice(2));
	if (rawOptions.help) {
		printUsage();
		return;
	}

	const options = resolveProvisionOptions(rawOptions);
	const result = await provisionVault(options);

	if (options.json) {
		console.log(JSON.stringify(result, null, 2));
	} else {
		console.log(`Provisioned Obsidian E2E vault ${result.vaultName}`);
		console.log(`Vault path: ${result.vaultPath}`);
		console.log(`PodNotes plugin: ${result.pluginPath}`);
		// Provisioning only lays down vault files; it does not launch Obsidian,
		// disable Restricted Mode, or confirm the plugin loads. Use
		// `npm run start:e2e-obsidian` / `npm run obsidian:e2e` for that.
		console.log(
			"Plugin not yet verified — start an instance to trust & load it.",
		);
	}

	if (options.printEnv) {
		console.log(toShellExports(result));
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
