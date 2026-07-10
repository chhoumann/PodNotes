import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { analyzeCommits } from "@semantic-release/commit-analyzer";
import { generateNotes } from "@semantic-release/release-notes-generator";
import { assertReleaseVersion, validateCurrentVersionFiles } from "./release-contract.mjs";

/** @type {Array<{ type: string; scope?: string; release: "patch" }>} */
export const RELEASE_RULES = [
	{ type: "chore", release: "patch" },
	{ scope: "deps", type: "build", release: "patch" },
];

const RELEASE_TYPES = new Set(["major", "minor", "patch"]);
const silentLogger = { error() {}, log() {}, success() {}, warn() {} };

/** @param {string} cwd @param {string[]} args */
function git(cwd, args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		maxBuffer: 10 * 1024 * 1024,
	}).trim();
}

/** @param {string} version */
function versionParts(version) {
	assertReleaseVersion(version);
	return version.split(".").map(Number);
}

/** @param {string} left @param {string} right */
function compareVersions(left, right) {
	const leftParts = versionParts(left);
	const rightParts = versionParts(right);
	for (let index = 0; index < 3; index += 1) {
		if (leftParts[index] !== rightParts[index]) {
			return leftParts[index] - rightParts[index];
		}
	}
	return 0;
}

/** @param {string} version @param {string} releaseType */
export function incrementVersion(version, releaseType) {
	const [major, minor, patchVersion] = versionParts(version);
	if (releaseType === "major") return `${major + 1}.0.0`;
	if (releaseType === "minor") return `${major}.${minor + 1}.0`;
	if (releaseType === "patch") return `${major}.${minor}.${patchVersion + 1}`;
	throw new Error(`Unsupported release type: ${releaseType}`);
}

/** @param {string} cwd */
function repositoryUrl(cwd) {
	const packageJson = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
	const value =
		typeof packageJson.repository === "string"
			? packageJson.repository
			: packageJson.repository?.url;
	if (typeof value !== "string" || !value) {
		throw new Error("package.json must provide a repository URL for release notes.");
	}
	return value;
}

/** @param {string} cwd @param {string | undefined} expectedVersion */
function latestStableTag(cwd, expectedVersion) {
	const output = git(cwd, ["tag", "--merged", "HEAD"]);
	let tags = output
		.split("\n")
		.map((tag) => tag.trim())
		.filter((tag) => /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
		.sort((left, right) => compareVersions(right, left));
	if (expectedVersion) {
		let expectedTagSha;
		try {
			expectedTagSha = execFileSync(
				"git",
				["rev-parse", "--verify", `${expectedVersion}^{commit}`],
				{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
			).trim();
		} catch {
			expectedTagSha = undefined;
		}
		if (expectedTagSha) {
			const head = git(cwd, ["rev-parse", "HEAD"]);
			if (expectedTagSha !== head) {
				throw new Error(
					`Existing expected tag ${expectedVersion} points to ${expectedTagSha}, not HEAD ${head}.`,
				);
			}
			tags = tags.filter((tag) => tag !== expectedVersion);
		}
	}
	return tags[0] ?? null;
}

/** @param {string} cwd @param {string | null} fromTag */
function commitsSince(cwd, fromTag) {
	const range = fromTag ? `${fromTag}..HEAD` : "HEAD";
	const hashes = git(cwd, ["rev-list", range])
		.split("\n")
		.map((hash) => hash.trim())
		.filter(Boolean);
	return hashes.map((hash) => {
		const fields = execFileSync(
			"git",
			["show", "-s", "--format=%H%x00%aN%x00%aE%x00%aI%x00%cI%x00%D%x00%B", hash],
			{ cwd, encoding: "utf8", maxBuffer: 1024 * 1024 },
		).split("\0");
		if (fields.length !== 7) throw new Error(`Unable to parse release commit ${hash}.`);
		const [commitHash, authorName, authorEmail, authorDate, committerDate, gitTags, message] =
			fields;
		return {
			authorDate,
			authorEmail,
			authorName,
			committerDate,
			gitTags: gitTags.trim(),
			hash: commitHash,
			message: message.trim(),
		};
	});
}

/**
 * @typedef {{
 *   cwd: string;
 *   analyzer?: typeof analyzeCommits;
 *   expectedVersion?: string;
 *   notesGenerator?: typeof generateNotes;
 * }} CalculatePlanOptions
 */

/** @param {CalculatePlanOptions} options */
export async function calculateReleasePlan(options) {
	const cwd = path.resolve(options.cwd);
	const baseSha = git(cwd, ["rev-parse", "HEAD"]);
	const expectedVersion = options.expectedVersion
		? assertReleaseVersion(options.expectedVersion)
		: undefined;
	const lastTag = latestStableTag(cwd, expectedVersion);
	const currentVersion = validateCurrentVersionFiles(cwd).version;
	if (expectedVersion) {
		if (currentVersion !== expectedVersion) {
			throw new Error(
				`Synchronized version is ${currentVersion}, expected release ${expectedVersion}.`,
			);
		}
	} else if (!lastTag || currentVersion !== lastTag) {
		throw new Error(
			`Synchronized version ${currentVersion} does not match latest stable tag ${lastTag ?? "none"}.`,
		);
	}
	const previousVersion = lastTag ?? "0.0.0";
	const lastReleaseSha = lastTag ? git(cwd, ["rev-parse", `${lastTag}^{commit}`]) : "";
	const commits = commitsSince(cwd, lastTag);
	const analyzer = options.analyzer ?? analyzeCommits;
	const releaseType = await analyzer(
		{ releaseRules: RELEASE_RULES },
		{ commits, cwd, logger: silentLogger },
	);

	if (!releaseType) {
		return {
			baseSha,
			notes: "",
			release: false,
			schemaVersion: 1,
		};
	}
	if (!RELEASE_TYPES.has(releaseType)) {
		throw new Error(`Unsupported release type from commit analyzer: ${releaseType}`);
	}
	const version = incrementVersion(previousVersion, releaseType);
	const releaseDate = git(cwd, ["show", "-s", "--format=%cI", "HEAD"]).slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
		throw new Error("Unable to determine a stable release date from HEAD.");
	}
	const notesGenerator = options.notesGenerator ?? generateNotes;
	const generatedNotes = await notesGenerator(
		{
			writerOpts: {
				finalizeContext: (context) => ({ ...context, date: releaseDate }),
			},
		},
		{
			commits,
			cwd,
			lastRelease: {
				gitHead: lastReleaseSha,
				gitTag: lastTag ?? "",
				version: lastTag ?? "",
			},
			logger: silentLogger,
			nextRelease: {
				gitHead: baseSha,
				gitTag: version,
				type: releaseType,
				version,
			},
			options: { repositoryUrl: repositoryUrl(cwd) },
		},
	);
	if (typeof generatedNotes !== "string") {
		throw new Error("Release notes generator did not return text.");
	}
	const notes = generatedNotes.trim()
		? generatedNotes
		: `## ${version}\n\nMaintenance release.\n`;
	return {
		baseSha,
		nextVersion: version,
		notes,
		previousVersion: lastTag,
		release: true,
		releaseType,
		schemaVersion: 1,
	};
}

/** @param {string[]} argv */
function parseArgs(argv) {
	/** @type {{ cwd: string; expectedVersion?: string; notesOutput?: string; output?: string }} */
	const options = { cwd: process.cwd() };
	for (let index = 0; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error(`Invalid release-plan argument near ${String(key)}.`);
		}
		if (key === "--cwd") options.cwd = value;
		else if (key === "--expected-version") options.expectedVersion = value;
		else if (key === "--notes-output") options.notesOutput = value;
		else if (key === "--output") options.output = value;
		else throw new Error(`Unknown release-plan option: ${key}`);
	}
	return options;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const expectedVersion = options.expectedVersion
		? assertReleaseVersion(options.expectedVersion)
		: undefined;
	const plan = await calculateReleasePlan({
		cwd: path.resolve(options.cwd),
		expectedVersion,
	});
	if (options.expectedVersion) {
		if (!plan.release || plan.nextVersion !== expectedVersion) {
			throw new Error(
				`Release plan version is ${plan.release ? plan.nextVersion : "none"}, expected ${expectedVersion}.`,
			);
		}
	}
	const serialized = `${JSON.stringify(plan, null, "\t")}\n`;
	if (options.output) fs.writeFileSync(path.resolve(options.output), serialized, { flag: "wx" });
	if (options.notesOutput) {
		fs.writeFileSync(path.resolve(options.notesOutput), plan.notes, { flag: "wx" });
	}
	console.log(JSON.stringify(plan));
}

const isMain =
	process.argv[1] &&
	path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
	main().catch((error) => {
		console.error(error);
		process.exitCode = 1;
	});
}
