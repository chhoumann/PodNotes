// @ts-check

import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.env.npm_package_version;

if (!targetVersion) {
	throw new Error("npm_package_version is required; run this script through `npm version`.");
}

// read minAppVersion from manifest.json and bump version to target version
let manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const { minAppVersion } = manifest;
manifest.version = targetVersion;
// Write a trailing newline so the file stays Biome-clean (format:check). Without
// it, every release commit silently strips the newline and the next PR fails.
writeFileSync("manifest.json", `${JSON.stringify(manifest, null, "\t")}\n`);

// update versions.json with target version and minAppVersion from manifest.json
let versions = JSON.parse(readFileSync("versions.json", "utf8"));
versions[targetVersion] = minAppVersion;
writeFileSync("versions.json", `${JSON.stringify(versions, null, "\t")}\n`);
