import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureFolderExists } from "./ensureFolderExists";
import { plugin } from "../store";

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

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

	plugin.set({
		app: {
			vault: {
				getAbstractFileByPath: (path: string) => (present.has(path) ? { path } : null),
				createFolder,
			},
		},
	} as never);

	return { created, createFolder };
}

afterEach(() => {
	plugin.set(undefined as never);
});

describe("ensureFolderExists", () => {
	it("creates each missing segment, parents first", async () => {
		const { created } = setupApp();

		await ensureFolderExists("podcast/My Show/Season 1");

		expect(created).toEqual(["podcast", "podcast/My Show", "podcast/My Show/Season 1"]);
	});

	it("does not recreate existing intermediate folders", async () => {
		const { created, createFolder } = setupApp(["podcast", "podcast/My Show"]);

		await expect(ensureFolderExists("podcast/My Show/Season 1")).resolves.toBeUndefined();

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

	it("swallows 'already exists' when the case-sensitive lookup misses an existing folder", async () => {
		// Mimic a case-insensitive filesystem: the folder is present on disk but
		// the case-sensitive getAbstractFileByPath never finds it, so createFolder
		// throws "Folder already exists". The helper must treat that as success
		// (regression guard for #87's spurious "Failed to create note").
		const createFolder = vi.fn(async () => {
			throw new Error("Folder already exists.");
		});
		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: () => null,
					createFolder,
				},
			},
		} as never);

		await expect(ensureFolderExists("Podcasts/My Show")).resolves.toBeUndefined();
		expect(createFolder).toHaveBeenCalled();
	});

	it("uses a passed vault instead of the default app.vault", async () => {
		// The default (plugin app) vault would record nothing; the injected vault
		// must be used.
		setupApp();
		const created: string[] = [];
		const injected = {
			getAbstractFileByPath: () => null,
			createFolder: vi.fn(async (path: string) => {
				created.push(path);
			}),
		} as unknown as Parameters<typeof ensureFolderExists>[1];

		await ensureFolderExists("Podcasts/My Show", injected);

		expect(created).toEqual(["Podcasts", "Podcasts/My Show"]);
	});

	it("rethrows a genuine createFolder failure", async () => {
		const createFolder = vi.fn(async () => {
			throw new Error("EACCES: permission denied");
		});
		plugin.set({
			app: {
				vault: {
					getAbstractFileByPath: () => null,
					createFolder,
				},
			},
		} as never);

		await expect(ensureFolderExists("Podcasts/My Show")).rejects.toThrow("EACCES");
	});

	it("stops between folder segments when the lifecycle guard fails", async () => {
		const firstCreate = deferred();
		const created: string[] = [];
		const createFolder = vi.fn(async (path: string) => {
			created.push(path);
			if (created.length === 1) await firstCreate.promise;
		});
		const vault = {
			getAbstractFileByPath: () => null,
			createFolder,
		} as unknown as Parameters<typeof ensureFolderExists>[1];
		const lifecycleError = new DOMException("plugin unloaded", "AbortError");
		let active = true;
		const guard = () => {
			if (!active) throw lifecycleError;
		};
		const pending = ensureFolderExists("Podcasts/My Show/Season 1", vault, guard);
		await vi.waitFor(() => expect(createFolder).toHaveBeenCalledOnce());
		active = false;
		firstCreate.resolve();

		await expect(pending).rejects.toBe(lifecycleError);
		expect(created).toEqual(["Podcasts"]);
	});
});
