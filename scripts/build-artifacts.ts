import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

const MAIN_BUNDLE = "main.js";
const SOURCE_MAP = "main.js.map";

export interface BuildArtifactPluginOptions {
	isProduction: boolean;
	outDir: string;
	rootDir: string;
}

function assertReplaceableGeneratedFile(filePath: string): boolean {
	let stat: fs.Stats;

	try {
		stat = fs.lstatSync(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}

	if (!stat.isFile() && !stat.isSymbolicLink()) {
		throw new Error(`Refusing to replace non-file build artifact at ${filePath}.`);
	}

	return true;
}

function removeGeneratedFile(filePath: string): void {
	if (assertReplaceableGeneratedFile(filePath)) fs.unlinkSync(filePath);
}

function assertRegularFile(filePath: string): void {
	let stat: fs.Stats;

	try {
		stat = fs.lstatSync(filePath);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			throw new Error(`Expected generated build artifact at ${filePath}.`);
		}
		throw error;
	}

	if (!stat.isFile()) {
		throw new Error(`Expected generated build artifact to be a regular file at ${filePath}.`);
	}
}

function installRegularFile(sourcePath: string, destinationPath: string, outDir: string): void {
	assertRegularFile(sourcePath);

	const stagedPath = path.join(outDir, ".podnotes-root-main.js.tmp");
	removeGeneratedFile(stagedPath);
	fs.copyFileSync(sourcePath, stagedPath);

	try {
		removeGeneratedFile(destinationPath);
		fs.renameSync(stagedPath, destinationPath);
	} catch (error) {
		removeGeneratedFile(stagedPath);
		throw error;
	}
}

function installSymlink(sourcePath: string, destinationPath: string): void {
	assertRegularFile(sourcePath);
	removeGeneratedFile(destinationPath);
	fs.symlinkSync(sourcePath, destinationPath);
}

function assertExpectedOutput(
	bundle: Record<string, { isEntry?: boolean; type: string }>,
	isProduction: boolean,
): void {
	const main = bundle[MAIN_BUNDLE];
	if (!main || main.type !== "chunk" || !main.isEntry) {
		throw new Error(`Expected ${MAIN_BUNDLE} to be the build entry chunk.`);
	}

	const allowedFiles = new Set([MAIN_BUNDLE, ...(isProduction ? [] : [SOURCE_MAP])]);
	const unexpectedFiles = Object.keys(bundle).filter((fileName) => !allowedFiles.has(fileName));

	if (unexpectedFiles.length > 0) {
		throw new Error(
			`PodNotes must ship as one JavaScript bundle; unexpected output: ${unexpectedFiles.join(", ")}.`,
		);
	}
}

export function createBuildArtifactPlugin(options: BuildArtifactPluginOptions) {
	const rootDir = path.resolve(options.rootDir);
	const outDir = path.resolve(options.outDir);
	const builtMain = path.join(outDir, MAIN_BUNDLE);
	const builtMap = path.join(outDir, SOURCE_MAP);
	const rootMain = path.join(rootDir, MAIN_BUNDLE);
	const rootMap = path.join(rootDir, SOURCE_MAP);

	return {
		name: "podnotes-build-artifacts",
		writeBundle(_outputOptions, bundle) {
			assertExpectedOutput(bundle, options.isProduction);
			assertRegularFile(builtMain);
			assertReplaceableGeneratedFile(rootMain);
			assertReplaceableGeneratedFile(rootMap);

			if (options.isProduction) {
				installRegularFile(builtMain, rootMain, outDir);
				removeGeneratedFile(rootMap);
				return;
			}

			if (fs.existsSync(builtMap)) assertRegularFile(builtMap);
			installSymlink(builtMain, rootMain);
			if (fs.existsSync(builtMap)) {
				installSymlink(builtMap, rootMap);
			} else {
				removeGeneratedFile(rootMap);
			}
		},
	} satisfies Plugin;
}
