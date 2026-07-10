import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import PodNotes from "./main";

function makePlugin(
	saveData: (data: unknown) => Promise<void> = vi.fn().mockResolvedValue(undefined),
): PodNotes {
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin, {
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
			loadData: vi.fn().mockResolvedValue({ schemaVersion: 2 }),
		});
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await expect(plugin.loadSettings()).rejects.toThrow(/schema v2/);
		expect(saveData).not.toHaveBeenCalled();
	});

	it("writes schema v1, canonical dates, and preserved unknown fields", async () => {
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
				schemaVersion: 1,
				retained: { enabled: true },
				currentEpisode: expect.objectContaining({
					episodeDate: "2024-03-01T10:05:03.000Z",
				}),
			}),
		);
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
