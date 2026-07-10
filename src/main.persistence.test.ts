import { afterEach, describe, expect, it, vi } from "vitest";
import type { SecretStorage } from "obsidian";
import { DEFAULT_SETTINGS } from "./constants";
import PodNotes from "./main";
import { CredentialRepository } from "./services/CredentialRepository";

function memorySecretStorage(initial: Record<string, string> = {}) {
	const values = new Map(Object.entries(initial));
	const storage = {
		getSecret: vi.fn((id: string) => values.get(id) ?? null),
		setSecret: vi.fn((id: string, value: string) => values.set(id, value)),
		listSecrets: vi.fn(() => [...values.keys()]),
	} as unknown as SecretStorage;
	return { storage, values };
}

function makePlugin(
	saveData: (data: unknown) => Promise<void> = vi.fn().mockResolvedValue(undefined),
): PodNotes {
	const { storage } = memorySecretStorage();
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin, {
		app: { secretStorage: storage },
		credentials: new CredentialRepository(storage),
		isReady: true,
		settings: structuredClone(DEFAULT_SETTINGS),
		pendingSave: null,
		pendingSaveWaiters: [],
		saveScheduled: false,
		saveChain: Promise.resolve(),
		persistenceUnknownFields: {},
		saveData,
	});
	return plugin;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("PodNotes persistence integration", () => {
	it("loads legacy JSON dates as Date instances", async () => {
		const plugin = makePlugin();
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue({
				currentEpisode: {
					title: "Restored",
					streamUrl: "restored.mp3",
					url: "",
					description: "",
					content: "",
					podcastName: "Podcast",
					episodeDate: "2024-03-01T10:05:03.000Z",
				},
			}),
		});

		await plugin.loadSettings();

		expect(plugin.settings.currentEpisode?.episodeDate).toEqual(
			new Date("2024-03-01T10:05:03.000Z"),
		);
	});

	it("refuses future data before any save can overwrite it", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue({ schemaVersion: 3 }),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow(/schema v3/);
		expect(saveData).not.toHaveBeenCalled();
	});

	it("writes schema v2, canonical dates, and preserved unknown fields", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		plugin.settings.currentEpisode = {
			title: "Current",
			streamUrl: "current.mp3",
			url: "",
			description: "",
			content: "",
			podcastName: "Podcast",
			episodeDate: new Date("2024-03-01T10:05:03.000Z"),
		};
		Object.assign(plugin, { persistenceUnknownFields: { retained: { enabled: true } } });

		await plugin.saveSettings();

		expect(saveData).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaVersion: 2,
				retained: { enabled: true },
				currentEpisode: expect.objectContaining({
					episodeDate: "2024-03-01T10:05:03.000Z",
				}),
			}),
		);
	});

	it("moves legacy credentials into SecretStorage before writing schema v2", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const { storage, values } = memorySecretStorage();
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			app: { secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue({
				schemaVersion: 1,
				openAIApiKey: "sk-legacy",
				diarizationApiKey: "dg-legacy",
				retained: true,
			}),
		});

		await plugin.loadSettings();

		expect(values.get("podnotes-openai-api-key")).toBe("sk-legacy");
		expect(values.get("podnotes-deepgram-api-key")).toBe("dg-legacy");
		expect(plugin.settings.openAISecretId).toBe("podnotes-openai-api-key");
		expect(plugin.settings.deepgramSecretId).toBe("podnotes-deepgram-api-key");
		expect(saveData).toHaveBeenCalledTimes(1);
		const persisted = saveData.mock.calls[0][0] as Record<string, unknown>;
		expect(persisted).toEqual(
			expect.objectContaining({
				schemaVersion: 2,
				openAISecretId: "podnotes-openai-api-key",
				deepgramSecretId: "podnotes-deepgram-api-key",
				retained: true,
			}),
		);
		expect(persisted).not.toHaveProperty("openAIApiKey");
		expect(persisted).not.toHaveProperty("diarizationApiKey");
	});

	it("leaves legacy data untouched when SecretStorage migration fails", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const raw = { schemaVersion: 1, openAIApiKey: "sk", defaultVolume: 0.3 };
		const storage = {
			getSecret: vi.fn(() => null),
			setSecret: vi.fn(() => {
				throw new Error("keychain unavailable");
			}),
			listSecrets: vi.fn(() => []),
		} as unknown as SecretStorage;
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			app: { secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue(raw),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow("keychain unavailable");
		expect(saveData).not.toHaveBeenCalled();
		expect(raw).toEqual({ schemaVersion: 1, openAIApiKey: "sk", defaultVolume: 0.3 });
	});

	it("does not save v2 when the second credential write fails", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const values = new Map<string, string>();
		const storage = {
			getSecret: vi.fn((id: string) => values.get(id) ?? null),
			setSecret: vi.fn((id: string, value: string) => {
				if (id.startsWith("podnotes-deepgram")) throw new Error("Deepgram write failed");
				values.set(id, value);
			}),
			listSecrets: vi.fn(() => [...values.keys()]),
		} as unknown as SecretStorage;
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			app: { secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue({
				schemaVersion: 1,
				openAIApiKey: "sk-created",
				diarizationApiKey: "dg-fails",
			}),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow("Deepgram write failed");
		expect(values.get("podnotes-openai-api-key")).toBe("sk-created");
		expect(saveData).not.toHaveBeenCalled();
	});

	it("reuses an already-created secret after the v2 save fails and is retried", async () => {
		const { storage, values } = memorySecretStorage();
		const raw = { schemaVersion: 1, openAIApiKey: "sk-retry" };
		const first = makePlugin(vi.fn().mockRejectedValue(new Error("disk full")));
		Object.assign(first, {
			app: { secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue(raw),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(first.loadSettings()).rejects.toThrow("disk full");
		expect(values.get("podnotes-openai-api-key")).toBe("sk-retry");

		const retrySave = vi.fn().mockResolvedValue(undefined);
		const retry = makePlugin(retrySave);
		Object.assign(retry, {
			app: { secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue(raw),
		});
		await retry.loadSettings();

		expect(retry.settings.openAISecretId).toBe("podnotes-openai-api-key");
		expect(values.has("podnotes-openai-api-key-2")).toBe(false);
		expect(retrySave).toHaveBeenCalledWith(
			expect.objectContaining({
				schemaVersion: 2,
				openAISecretId: "podnotes-openai-api-key",
			}),
		);
	});

	it("does not rewrite data that is already schema v2", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			loadData: vi.fn().mockResolvedValue({ schemaVersion: 2, defaultVolume: 0.4 }),
		});

		await plugin.loadSettings();

		expect(plugin.settings.defaultVolume).toBe(0.4);
		expect(saveData).not.toHaveBeenCalled();
	});

	it("scrubs retired plaintext fields from schema v2 without importing them", async () => {
		const saveData = vi.fn().mockResolvedValue(undefined);
		const { storage, values } = memorySecretStorage();
		const plugin = makePlugin(saveData);
		Object.assign(plugin, {
			app: { secretStorage: storage },
			credentials: new CredentialRepository(storage),
			loadData: vi.fn().mockResolvedValue({
				schemaVersion: 2,
				openAIApiKey: "must-not-import",
				defaultVolume: 0.4,
			}),
		});

		await plugin.loadSettings();

		expect(values.size).toBe(0);
		expect(plugin.settings.openAISecretId).toBe("");
		expect(saveData).toHaveBeenCalledTimes(1);
		expect(saveData.mock.calls[0][0]).toEqual(
			expect.objectContaining({ schemaVersion: 2, defaultVolume: 0.4 }),
		);
		expect(saveData.mock.calls[0][0]).not.toHaveProperty("openAIApiKey");
	});

	it("fails closed if a v2 retired-field scrub cannot be persisted", async () => {
		const plugin = makePlugin(vi.fn().mockRejectedValue(new Error("disk full")));
		Object.assign(plugin, {
			loadData: vi
				.fn()
				.mockResolvedValue({ schemaVersion: 2, openAIApiKey: "must-stay-unread" }),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow("disk full");
		expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
	});

	it("rejects a strict caller when saveData fails", async () => {
		const failure = new Error("disk full");
		const plugin = makePlugin(vi.fn().mockRejectedValue(failure));
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.saveSettingsStrict()).rejects.toBe(failure);
	});

	it("keeps best-effort saves nonrejecting while logging disk failure", async () => {
		const failure = new Error("disk full");
		const plugin = makePlugin(vi.fn().mockRejectedValue(failure));
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.saveSettings()).resolves.toBeUndefined();
		expect(consoleError).toHaveBeenCalledWith("PodNotes: failed to save settings", failure);
	});

	it("normalizes a synchronous snapshot failure into the two save contracts", async () => {
		const failure = new Error("cannot clone");
		const plugin = makePlugin();
		vi.spyOn(globalThis, "structuredClone").mockImplementation(() => {
			throw failure;
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		let strict: Promise<void> | undefined;
		expect(() => {
			strict = plugin.saveSettingsStrict();
		}).not.toThrow();
		await expect(strict).rejects.toBe(failure);
		await expect(plugin.saveSettings()).resolves.toBeUndefined();
	});

	it("keeps later callers pending until their newer snapshot is durable", async () => {
		const resolvers: Array<() => void> = [];
		const writes: unknown[] = [];
		const plugin = makePlugin(
			vi.fn((data: unknown) => {
				writes.push(data);
				return new Promise<void>((resolve) => resolvers.push(resolve));
			}),
		);

		const first = plugin.saveSettingsStrict();
		await vi.waitFor(() => expect(writes).toHaveLength(1));
		plugin.settings.defaultVolume = 0.25;
		const second = plugin.saveSettingsStrict();
		let secondResolved = false;
		void second.then(() => {
			secondResolved = true;
		});

		resolvers[0]();
		await first;
		await vi.waitFor(() => expect(writes).toHaveLength(2));
		expect(secondResolved).toBe(false);
		expect(writes[1]).toEqual(expect.objectContaining({ defaultVolume: 0.25 }));

		resolvers[1]();
		await second;
		expect(secondResolved).toBe(true);
	});
});
