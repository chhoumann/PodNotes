import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createBuildArtifactPlugin } from "./build-artifacts";

const tempRoots: string[] = [];

type ArtifactPlugin = ReturnType<typeof createBuildArtifactPlugin>;
type OutputOptions = Parameters<ArtifactPlugin["writeBundle"]>[0];
type OutputBundle = Parameters<ArtifactPlugin["writeBundle"]>[1];
type PluginContext = ThisParameterType<ArtifactPlugin["writeBundle"]>;

async function makeFixture() {
	const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "podnotes-build-artifacts-"));
	const outDir = path.join(rootDir, "build");
	tempRoots.push(rootDir);
	await fs.mkdir(outDir);

	return {
		builtMain: path.join(outDir, "main.js"),
		builtMap: path.join(outDir, "main.js.map"),
		outDir,
		rootDir,
		rootMain: path.join(rootDir, "main.js"),
		rootMap: path.join(rootDir, "main.js.map"),
	};
}

function outputBundle(...fileNames: string[]): OutputBundle {
	return Object.fromEntries(
		fileNames.map((fileName) => [
			fileName,
			fileName === "main.js"
				? { type: "chunk", fileName, isEntry: true }
				: { type: "asset", fileName },
		]),
	) as OutputBundle;
}

function writeBundle(plugin: ArtifactPlugin, bundle: OutputBundle): void {
	plugin.writeBundle.call({} as PluginContext, {} as OutputOptions, bundle);
}

afterEach(async () => {
	await Promise.all(
		tempRoots.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
	);
});

describe("build artifact plugin", () => {
	it("replaces development symlinks with a regular production artifact and removes the map", async () => {
		const fixture = await makeFixture();
		await fs.writeFile(fixture.builtMain, "production bundle\n");
		await fs.writeFile(fixture.builtMap, "stale development map\n");
		await fs.symlink(fixture.builtMain, fixture.rootMain);
		await fs.symlink(fixture.builtMap, fixture.rootMap);

		writeBundle(
			createBuildArtifactPlugin({
				isProduction: true,
				outDir: fixture.outDir,
				rootDir: fixture.rootDir,
			}),
			outputBundle("main.js"),
		);

		expect((await fs.lstat(fixture.rootMain)).isFile()).toBe(true);
		expect((await fs.lstat(fixture.rootMain)).isSymbolicLink()).toBe(false);
		await expect(fs.readFile(fixture.rootMain, "utf8")).resolves.toBe("production bundle\n");
		await expect(fs.lstat(fixture.rootMap)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("replaces production files with development symlinks", async () => {
		const fixture = await makeFixture();
		await fs.writeFile(fixture.builtMain, "development bundle\n");
		await fs.writeFile(fixture.builtMap, "development map\n");
		await fs.writeFile(fixture.rootMain, "old production bundle\n");
		await fs.writeFile(fixture.rootMap, "old map\n");

		writeBundle(
			createBuildArtifactPlugin({
				isProduction: false,
				outDir: fixture.outDir,
				rootDir: fixture.rootDir,
			}),
			outputBundle("main.js", "main.js.map"),
		);

		expect(path.resolve(fixture.rootDir, await fs.readlink(fixture.rootMain))).toBe(
			fixture.builtMain,
		);
		expect(path.resolve(fixture.rootDir, await fs.readlink(fixture.rootMap))).toBe(
			fixture.builtMap,
		);
	});

	it("removes a stale root map when a development build does not emit one", async () => {
		const fixture = await makeFixture();
		await fs.writeFile(fixture.builtMain, "development bundle\n");
		await fs.writeFile(fixture.rootMap, "stale map\n");

		writeBundle(
			createBuildArtifactPlugin({
				isProduction: false,
				outDir: fixture.outDir,
				rootDir: fixture.rootDir,
			}),
			outputBundle("main.js"),
		);

		await expect(fs.lstat(fixture.rootMap)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects missing or additional distributable outputs before replacing the root artifact", async () => {
		const fixture = await makeFixture();
		await fs.writeFile(fixture.builtMain, "new bundle\n");
		await fs.writeFile(fixture.rootMain, "existing bundle\n");
		const plugin = createBuildArtifactPlugin({
			isProduction: true,
			outDir: fixture.outDir,
			rootDir: fixture.rootDir,
		});

		expect(() => writeBundle(plugin, outputBundle())).toThrow(
			"Expected main.js to be the build entry chunk.",
		);
		expect(() => writeBundle(plugin, outputBundle("main.js", "extra.js"))).toThrow(
			"PodNotes must ship as one JavaScript bundle; unexpected output: extra.js.",
		);
		await expect(fs.readFile(fixture.rootMain, "utf8")).resolves.toBe("existing bundle\n");
	});

	it("refuses to replace a directory at a release artifact path", async () => {
		const fixture = await makeFixture();
		await fs.writeFile(fixture.builtMain, "production bundle\n");
		await fs.mkdir(fixture.rootMain);

		expect(() =>
			writeBundle(
				createBuildArtifactPlugin({
					isProduction: true,
					outDir: fixture.outDir,
					rootDir: fixture.rootDir,
				}),
				outputBundle("main.js"),
			),
		).toThrow(`Refusing to replace non-file build artifact at ${fixture.rootMain}.`);
		expect((await fs.lstat(fixture.rootMain)).isDirectory()).toBe(true);
	});

	it.each([
		{ isProduction: true, outputs: ["main.js"] },
		{ isProduction: false, outputs: ["main.js", "main.js.map"] },
	])(
		"preflights every root destination before a $isProduction transition",
		async ({ isProduction, outputs }) => {
			const fixture = await makeFixture();
			await fs.writeFile(fixture.builtMain, "new bundle\n");
			await fs.writeFile(fixture.builtMap, "new map\n");
			await fs.writeFile(fixture.rootMain, "existing bundle\n");
			await fs.mkdir(fixture.rootMap);

			expect(() =>
				writeBundle(
					createBuildArtifactPlugin({
						isProduction,
						outDir: fixture.outDir,
						rootDir: fixture.rootDir,
					}),
					outputBundle(...outputs),
				),
			).toThrow(`Refusing to replace non-file build artifact at ${fixture.rootMap}.`);
			await expect(fs.readFile(fixture.rootMain, "utf8")).resolves.toBe("existing bundle\n");
			expect((await fs.lstat(fixture.rootMap)).isDirectory()).toBe(true);
		},
	);
});
