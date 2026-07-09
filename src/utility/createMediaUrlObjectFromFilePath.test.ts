import { describe, expect, it, vi } from "vitest";
import { TFile, type Vault } from "obsidian";
import { createMediaUrlObjectFromFilePath } from "./createMediaUrlObjectFromFilePath";

// `tsc` resolves `obsidian` to the real typings (TFile has a no-arg constructor),
// while Vitest aliases it to tests/mocks/obsidian.ts. Build a TFile that satisfies
// both: construct with no args, then set the path the helper reads.
function tfile(path: string): TFile {
	const file = new TFile();
	(file as unknown as { path: string }).path = path;
	return file;
}

function setupVault(
	opts: {
		resolve?: (path: string) => unknown;
		getResourcePath?: (file: TFile) => string;
	} = {},
) {
	const getResourcePath = vi.fn(
		opts.getResourcePath ?? ((file: TFile) => `app://resource/${file.path}?1`),
	);
	const getAbstractFileByPath = vi.fn(opts.resolve ?? ((path: string) => tfile(path)));

	const vault = { getAbstractFileByPath, getResourcePath } as unknown as Vault;

	return { vault, getResourcePath, getAbstractFileByPath };
}

describe("createMediaUrlObjectFromFilePath", () => {
	it("returns the Obsidian resource path for a vault file", () => {
		const { vault, getResourcePath, getAbstractFileByPath } = setupVault();

		const url = createMediaUrlObjectFromFilePath(vault, "Audio/ep.mp3");

		expect(getAbstractFileByPath).toHaveBeenCalledWith("Audio/ep.mp3");

		expect(url).toBe("app://resource/Audio/ep.mp3?1");
		expect(getResourcePath).toHaveBeenCalledTimes(1);
		// Must pass the TFile (not the raw string) so the TFile overload is used.
		expect(getResourcePath.mock.calls[0][0]).toBeInstanceOf(TFile);
	});

	it("does not produce a blob URL", () => {
		const { vault, getResourcePath } = setupVault({
			getResourcePath: () => "capacitor://localhost/_capacitor_file_/x.mp3?2",
		});

		const url = createMediaUrlObjectFromFilePath(vault, "x.mp3");

		expect(url).toBe("capacitor://localhost/_capacitor_file_/x.mp3?2");
		expect(url.startsWith("blob:")).toBe(false);
		expect(getResourcePath).toHaveBeenCalledTimes(1);
	});

	it("returns '' when the path does not resolve to a file", () => {
		const { vault, getResourcePath } = setupVault({ resolve: () => null });

		expect(createMediaUrlObjectFromFilePath(vault, "missing.mp3")).toBe("");
		expect(getResourcePath).not.toHaveBeenCalled();
	});

	it("returns '' when the path is not a TFile (e.g. a folder)", () => {
		const { vault, getResourcePath } = setupVault({
			resolve: (path) => ({ path }), // not a TFile instance
		});

		expect(createMediaUrlObjectFromFilePath(vault, "Some/Folder")).toBe("");
		expect(getResourcePath).not.toHaveBeenCalled();
	});

	it("resolves non-mp3 extensions too (MIME is the native server's concern)", () => {
		const seen: string[] = [];
		const { vault } = setupVault({
			getResourcePath: (file) => {
				seen.push(file.path);
				return `app://resource/${file.path}`;
			},
		});

		for (const path of ["a.wav", "b.flac", "c.m4a", "d.webm"]) {
			expect(createMediaUrlObjectFromFilePath(vault, path)).toBe(`app://resource/${path}`);
		}

		expect(seen).toEqual(["a.wav", "b.flac", "c.m4a", "d.webm"]);
	});
});
