import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureFolderExists } from "./ensureFolderExists";

function setupApp(existing: string[] = []) {
	const present = new Set(existing);
	const created: string[] = [];

	const createFolder = vi.fn(async (path: string) => {
		// Vault.createFolder throws if the folder already exists — the helper
		// must never call it for an existing prefix.
		if (present.has(path)) {
			throw new Error(`Folder already exists: ${path}`);
		}
		present.add(path);
		created.push(path);
	});

	(globalThis as { app?: unknown }).app = {
		vault: {
			getAbstractFileByPath: (path: string) =>
				present.has(path) ? { path } : null,
			createFolder,
		},
	};

	return { created, createFolder };
}

afterEach(() => {
	(globalThis as { app?: unknown }).app = undefined;
});

describe("ensureFolderExists", () => {
	it("creates each missing segment, parents first", async () => {
		const { created } = setupApp();

		await ensureFolderExists("podcast/My Show/Season 1");

		expect(created).toEqual([
			"podcast",
			"podcast/My Show",
			"podcast/My Show/Season 1",
		]);
	});

	it("does not recreate existing intermediate folders", async () => {
		const { created, createFolder } = setupApp(["podcast", "podcast/My Show"]);

		await expect(
			ensureFolderExists("podcast/My Show/Season 1"),
		).resolves.toBeUndefined();

		expect(created).toEqual(["podcast/My Show/Season 1"]);
		expect(createFolder).toHaveBeenCalledTimes(1);
	});

	it("is a no-op for an empty path (file at the vault root)", async () => {
		const { created, createFolder } = setupApp();

		await ensureFolderExists("");

		expect(created).toEqual([]);
		expect(createFolder).not.toHaveBeenCalled();
	});

	it("ignores empty segments from leading/trailing/double slashes", async () => {
		const { created } = setupApp();

		await ensureFolderExists("a//b/");

		expect(created).toEqual(["a", "a/b"]);
	});
});
