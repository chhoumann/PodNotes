import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

export const RELEASE_FILES = [
	"package.json",
	"package-lock.json",
	"manifest.json",
	"versions.json",
];
export const RELEASE_ASSETS = ["main.js", "manifest.json"];

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/**
 * @param {unknown} value
 * @param {string} label
 * @returns {asserts value is Record<string, unknown>}
 */
function assertRecord(value, label) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object.`);
	}
}

/** @param {unknown} value */
export function assertReleaseVersion(value) {
	if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
		throw new Error(`Invalid release version: ${String(value)}`);
	}
	return value;
}

/**
 * @param {string} root
 * @param {string} fileName
 */
function safeFilePath(root, fileName) {
	if (!RELEASE_FILES.includes(fileName) && !RELEASE_ASSETS.includes(fileName)) {
		throw new Error(`Unsupported release file: ${fileName}`);
	}
	const resolvedRoot = path.resolve(root);
	const resolvedFile = path.resolve(resolvedRoot, fileName);
	if (path.dirname(resolvedFile) !== resolvedRoot) {
		throw new Error(`Release file escapes its root: ${fileName}`);
	}
	return resolvedFile;
}

/** @param {string} filePath */
function readRegularFile(filePath) {
	const stat = fs.lstatSync(filePath);
	if (!stat.isFile() || stat.isSymbolicLink()) {
		throw new Error(`Release input must be a regular file: ${filePath}`);
	}
	return fs.readFileSync(filePath);
}

/**
 * @param {string} root
 * @param {string} fileName
 */
function readJson(root, fileName) {
	const filePath = safeFilePath(root, fileName);
	const value = /** @type {unknown} */ (JSON.parse(readRegularFile(filePath).toString("utf8")));
	assertRecord(value, fileName);
	return value;
}

/**
 * @param {string} filePath
 * @param {Record<string, unknown>} value
 */
function writeJson(filePath, value) {
	fs.writeFileSync(filePath, `${JSON.stringify(value, null, "\t")}\n`, {
		encoding: "utf8",
		flag: "wx",
	});
}

/** @param {Buffer} contents */
function fileMetadata(contents) {
	return {
		sha256: crypto.createHash("sha256").update(contents).digest("hex"),
		size: contents.byteLength,
	};
}

/**
 * @param {Record<string, unknown>} packageLock
 * @param {string} label
 */
function lockRootPackage(packageLock, label) {
	assertRecord(packageLock.packages, `${label}.packages`);
	const rootPackage = packageLock.packages[""];
	assertRecord(rootPackage, `${label}.packages[""]`);
	return rootPackage;
}

/**
 * @param {Record<string, unknown>} packageJson
 * @param {Record<string, unknown>} packageLock
 * @param {Record<string, unknown>} manifest
 * @param {string} label
 * @returns {string}
 */
function assertCurrentVersions(packageJson, packageLock, manifest, label) {
	const rootPackage = lockRootPackage(packageLock, label);
	const versions = [
		packageJson.version,
		packageLock.version,
		rootPackage.version,
		manifest.version,
	];
	if (!versions.every((version) => typeof version === "string" && version === versions[0])) {
		throw new Error(`${label} version fields are not synchronized.`);
	}
	return assertReleaseVersion(versions[0]);
}

/** @param {string} left @param {string} right */
function compareVersions(left, right) {
	const leftParts = assertReleaseVersion(left).split(".").map(Number);
	const rightParts = assertReleaseVersion(right).split(".").map(Number);
	for (let index = 0; index < 3; index += 1) {
		if (leftParts[index] !== rightParts[index]) {
			return leftParts[index] - rightParts[index];
		}
	}
	return 0;
}

/** @param {unknown} value @param {string} label */
function assertCompatibilityVersion(value, label) {
	if (typeof value !== "string" || !SEMVER_PATTERN.test(value)) {
		throw new Error(`${label} must be a stable semantic version.`);
	}
	return value;
}

/**
 * @param {Record<string, unknown>} versions
 * @param {string} version
 * @param {string} label
 */
function recordedMinAppVersion(versions, version, label) {
	const value = versions[version];
	if (typeof value !== "string" || !value) {
		throw new Error(`${label} versions.json does not record ${version}.`);
	}
	return assertCompatibilityVersion(value, `${label} compatibility record`);
}

/** @param {string} released @param {string} manifest @param {string} label */
function assertPendingMinAppVersion(released, manifest, label) {
	if (manifest !== released && compareVersions(manifest, released) <= 0) {
		throw new Error(
			`${label} minAppVersion must increase from the released compatibility floor.`,
		);
	}
}

/**
 * @param {string} root
 * @param {{ allowPendingMinAppVersion?: boolean }} [options]
 */
export function validateCurrentVersionFiles(root, options = {}) {
	const packageJson = readJson(root, "package.json");
	const packageLock = readJson(root, "package-lock.json");
	const manifest = readJson(root, "manifest.json");
	const versions = readJson(root, "versions.json");
	const version = assertCurrentVersions(packageJson, packageLock, manifest, "current");
	const manifestMinAppVersion = assertCompatibilityVersion(
		manifest.minAppVersion,
		"manifest.json minAppVersion",
	);
	const releasedMinAppVersion = recordedMinAppVersion(versions, version, "Current");
	if (options.allowPendingMinAppVersion) {
		assertPendingMinAppVersion(releasedMinAppVersion, manifestMinAppVersion, "Pending");
	} else if (releasedMinAppVersion !== manifestMinAppVersion) {
		throw new Error("versions.json does not record the current manifest version.");
	}
	return { minAppVersion: manifestMinAppVersion, version };
}

/**
 * @param {{ root: string; out: string; version: string; baseSha: string }} options
 */
export function materializeVersionFiles(options) {
	const version = assertReleaseVersion(options.version);
	if (!/^[0-9a-f]{40}$/i.test(options.baseSha)) {
		throw new Error(`Invalid base SHA: ${options.baseSha}`);
	}

	const outputRoot = path.resolve(options.out);
	fs.mkdirSync(outputRoot, { recursive: true });
	const outputStat = fs.lstatSync(outputRoot);
	if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
		throw new Error(`Release output must be a real directory: ${outputRoot}`);
	}
	if (fs.readdirSync(outputRoot).length > 0) {
		throw new Error(`Release output directory must be empty: ${outputRoot}`);
	}

	const packageJson = structuredClone(readJson(options.root, "package.json"));
	const packageLock = structuredClone(readJson(options.root, "package-lock.json"));
	const manifest = structuredClone(readJson(options.root, "manifest.json"));
	const versions = structuredClone(readJson(options.root, "versions.json"));
	const currentVersion = assertCurrentVersions(packageJson, packageLock, manifest, "source");
	if (compareVersions(version, currentVersion) <= 0) {
		throw new Error(`Release version ${version} must be newer than ${currentVersion}.`);
	}
	const releasedMinAppVersion = recordedMinAppVersion(versions, currentVersion, "Source");
	if (Object.prototype.hasOwnProperty.call(versions, version)) {
		throw new Error(`versions.json already contains ${version}.`);
	}
	const manifestMinAppVersion = assertCompatibilityVersion(
		manifest.minAppVersion,
		"manifest.json minAppVersion",
	);
	assertPendingMinAppVersion(releasedMinAppVersion, manifestMinAppVersion, "Source");

	packageJson.version = version;
	packageLock.version = version;
	lockRootPackage(packageLock, "package-lock.json").version = version;
	manifest.version = version;
	versions[version] = manifest.minAppVersion;

	const values = new Map([
		["package.json", packageJson],
		["package-lock.json", packageLock],
		["manifest.json", manifest],
		["versions.json", versions],
	]);
	const files = [];
	for (const fileName of RELEASE_FILES) {
		const outputPath = safeFilePath(outputRoot, fileName);
		const value = values.get(fileName);
		if (!value) throw new Error(`Missing materialized value for ${fileName}.`);
		writeJson(outputPath, value);
		const contents = readRegularFile(outputPath);
		files.push({ name: fileName, ...fileMetadata(contents) });
	}

	const metadata = {
		baseSha: options.baseSha.toLowerCase(),
		files,
		schemaVersion: 1,
		version,
	};
	writeJson(path.join(outputRoot, "release-version-files.json"), metadata);
	return metadata;
}

/**
 * @param {Record<string, unknown>} candidate
 * @param {Record<string, unknown>} baseline
 * @param {string} field
 */
function equalExceptField(candidate, baseline, field) {
	const normalized = structuredClone(candidate);
	normalized[field] = baseline[field];
	return isDeepStrictEqual(normalized, baseline);
}

/**
 * @param {{ baseRoot: string; candidateRoot: string; version: string }} options
 */
export function validateVersionFiles(options) {
	const version = assertReleaseVersion(options.version);
	const basePackage = readJson(options.baseRoot, "package.json");
	const nextPackage = readJson(options.candidateRoot, "package.json");
	const baseLock = readJson(options.baseRoot, "package-lock.json");
	const nextLock = readJson(options.candidateRoot, "package-lock.json");
	const baseManifest = readJson(options.baseRoot, "manifest.json");
	const nextManifest = readJson(options.candidateRoot, "manifest.json");
	const baseVersions = readJson(options.baseRoot, "versions.json");
	const nextVersions = readJson(options.candidateRoot, "versions.json");

	const baseVersion = assertCurrentVersions(basePackage, baseLock, baseManifest, "base");
	assertCurrentVersions(nextPackage, nextLock, nextManifest, "candidate");
	if (compareVersions(version, baseVersion) <= 0) {
		throw new Error(`Release version ${version} must be newer than ${baseVersion}.`);
	}
	const releasedMinAppVersion = recordedMinAppVersion(baseVersions, baseVersion, "Base");
	const baseManifestMinAppVersion = assertCompatibilityVersion(
		baseManifest.minAppVersion,
		"Base manifest minAppVersion",
	);
	assertPendingMinAppVersion(releasedMinAppVersion, baseManifestMinAppVersion, "Base manifest");
	assertCompatibilityVersion(nextManifest.minAppVersion, "Candidate manifest minAppVersion");
	if (nextPackage.version !== version) {
		throw new Error(
			`Candidate version is ${String(nextPackage.version)}, expected ${version}.`,
		);
	}
	if (!equalExceptField(nextPackage, basePackage, "version")) {
		throw new Error("package.json changed outside its version field.");
	}

	const normalizedLock = structuredClone(nextLock);
	normalizedLock.version = baseLock.version;
	lockRootPackage(normalizedLock, "candidate package-lock.json").version = lockRootPackage(
		baseLock,
		"base package-lock.json",
	).version;
	if (!isDeepStrictEqual(normalizedLock, baseLock)) {
		throw new Error("package-lock.json changed outside its version fields.");
	}
	if (!equalExceptField(nextManifest, baseManifest, "version")) {
		throw new Error("manifest.json changed outside its version field.");
	}
	if (Object.prototype.hasOwnProperty.call(baseVersions, version)) {
		throw new Error(`Base versions.json already contains ${version}.`);
	}
	if (nextVersions[version] !== nextManifest.minAppVersion) {
		throw new Error(`versions.json does not map ${version} to manifest minAppVersion.`);
	}
	const normalizedVersions = structuredClone(nextVersions);
	delete normalizedVersions[version];
	if (!isDeepStrictEqual(normalizedVersions, baseVersions)) {
		throw new Error("versions.json changed outside the new release entry.");
	}
	return { version };
}

/**
 * @param {unknown} input
 */
export function validateReleasePr(input) {
	assertRecord(input, "release PR input");
	const version = assertReleaseVersion(input.version);
	const expectedFiles = [...RELEASE_FILES].sort();
	if (
		!Array.isArray(input.changedFiles) ||
		!input.changedFiles.every((file) => typeof file === "string") ||
		!isDeepStrictEqual([...input.changedFiles].sort(), expectedFiles)
	) {
		throw new Error(`Release PR must change exactly: ${RELEASE_FILES.join(", ")}.`);
	}
	if (input.baseRef !== "master") throw new Error("Release PR base must be master.");
	if (input.branch !== `release/${version}`)
		throw new Error("Release PR branch/version mismatch.");
	if (input.title !== `release(version): Release ${version}`) {
		throw new Error("Release PR title/version mismatch.");
	}
	if (typeof input.repository !== "string" || input.headRepository !== input.repository) {
		throw new Error("Release PR must originate from this repository.");
	}
	return { version };
}

/**
 * @param {{ root: string; artifacts: string[]; output?: string }} options
 */
export function createArtifactManifest(options) {
	if (!isDeepStrictEqual([...options.artifacts].sort(), [...RELEASE_ASSETS].sort())) {
		throw new Error(`Release assets must be exactly: ${RELEASE_ASSETS.join(", ")}.`);
	}
	const artifacts = options.artifacts.map((name) => {
		const contents = readRegularFile(safeFilePath(options.root, name));
		return { name, ...fileMetadata(contents) };
	});
	const manifest = { artifacts, schemaVersion: 1 };
	if (options.output) {
		const outputPath = path.resolve(options.output);
		const outputDirectory = fs.lstatSync(path.dirname(outputPath));
		if (!outputDirectory.isDirectory() || outputDirectory.isSymbolicLink()) {
			throw new Error(`Manifest output parent must be a real directory: ${options.output}`);
		}
		writeJson(outputPath, manifest);
	}
	return manifest;
}

/** @param {string[]} argv */
function parseOptions(argv) {
	const command = argv[0];
	/** @type {Record<string, string>} */
	const options = {};
	for (let index = 1; index < argv.length; index += 2) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key?.startsWith("--") || value === undefined) {
			throw new Error(`Invalid release-contract argument near ${String(key)}.`);
		}
		options[key.slice(2)] = value;
	}
	return { command, options };
}

/** @param {Record<string, string>} options @param {string} name */
function requiredOption(options, name) {
	const value = options[name];
	if (!value) throw new Error(`Missing --${name}.`);
	return value;
}

async function main() {
	const { command, options } = parseOptions(process.argv.slice(2));
	let result;
	if (command === "materialize") {
		result = materializeVersionFiles({
			baseSha: requiredOption(options, "base-sha"),
			out: requiredOption(options, "out"),
			root: requiredOption(options, "root"),
			version: requiredOption(options, "version"),
		});
	} else if (command === "validate-files") {
		result = validateVersionFiles({
			baseRoot: requiredOption(options, "base-root"),
			candidateRoot: requiredOption(options, "candidate-root"),
			version: requiredOption(options, "version"),
		});
	} else if (command === "validate-pr") {
		const input = JSON.parse(
			readRegularFile(requiredOption(options, "input")).toString("utf8"),
		);
		result = validateReleasePr(input);
	} else if (command === "manifest") {
		result = createArtifactManifest({
			artifacts: requiredOption(options, "artifacts").split(","),
			output: requiredOption(options, "output"),
			root: requiredOption(options, "root"),
		});
	} else {
		throw new Error(`Unknown release-contract command: ${String(command)}`);
	}
	console.log(JSON.stringify(result));
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
