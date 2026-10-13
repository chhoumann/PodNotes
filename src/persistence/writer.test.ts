import { afterEach, describe, expect, it, vi } from "vitest";
import { manualClock } from "../../tests/mocks/dataFileWriter";
import { type DataFileAccess, DataFileWriter } from "./writer";

type Doc = {
	defaultVolume: number;
	savedFeeds: Record<string, { title: string }>;
	playedEpisodes: Record<string, { time: number }>;
};

function doc(): Doc {
	return {
		defaultVolume: 1,
		savedFeeds: { Local: { title: "Local" } },
		playedEpisodes: { "Pod::Ep": { time: 10 } },
	};
}

/** data.json and the in-memory state as two plain documents. */
function memoryFile(initial: Doc = doc()) {
	const state = {
		disk: structuredClone(initial) as Doc | null,
		memory: structuredClone(initial),
		writes: [] as Doc[],
		published: [] as Doc[],
		onPublish: () => {},
	};
	const access = {
		read: vi.fn(async (): Promise<Doc | null> => structuredClone(state.disk)),
		write: vi.fn(async (next: Doc) => {
			state.writes.push(structuredClone(next));
			state.disk = structuredClone(next);
		}),
		local: () => structuredClone(state.memory),
		publish: (next: Doc) => {
			state.published.push(structuredClone(next));
			state.memory = structuredClone(next);
			state.onPublish();
		},
	} satisfies DataFileAccess<Doc>;
	return { state, access };
}

function setup(initial: Doc = doc()) {
	const file = memoryFile(initial);
	const clock = manualClock();
	const writer = new DataFileWriter<Doc>(file.access, clock, structuredClone(initial));
	return { ...file, clock, writer };
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("DataFileWriter saves", () => {
	it("saves a change right away, once for a burst of changes", async () => {
		const { clock, state, writer } = setup();
		state.memory.defaultVolume = 0.5;

		writer.request();
		writer.request();
		writer.request();
		await vi.waitFor(() => expect(state.writes).toHaveLength(1));
		await writer.flush();

		expect(state.writes).toEqual([{ ...doc(), defaultVolume: 0.5 }]);
		expect(clock.pending()).toBe(0);
	});

	it("retries failed writes at the checkpoint interval and stops after recovery or unload", async () => {
		const { access, clock, state, writer } = setup();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		access.write
			.mockRejectedValueOnce(new Error("disk full"))
			.mockRejectedValueOnce(new Error("disk full"));
		state.memory.defaultVolume = 0.5;
		await expect(writer.save()).rejects.toThrow("disk full");

		clock.advance(10_000);
		clock.runAll();
		await vi.waitFor(() => expect(clock.delays).toEqual([10_000, 10_000]));
		expect(state.disk?.defaultVolume).toBe(1);

		clock.advance(10_000);
		clock.runAll();
		await vi.waitFor(() => expect(state.disk?.defaultVolume).toBe(0.5));
		expect(access.write).toHaveBeenCalledTimes(3);

		clock.advance(30_000);
		clock.runAll();
		await writer.flush();
		expect(state.disk).toEqual({ ...doc(), defaultVolume: 0.5 });
		expect(access.write).toHaveBeenCalledTimes(3);
		expect(clock.pending()).toBe(0);

		state.memory.defaultVolume = 0.75;
		access.write.mockRejectedValueOnce(new Error("disk full"));
		await writer.unload();
		expect(access.write).toHaveBeenCalledTimes(4);
		expect(clock.pending()).toBe(0);
	});

	it("saves a change made during a save right after it", async () => {
		const { access, state, writer } = setup();
		let finishWrite = () => {};
		access.write.mockImplementationOnce(async (next: Doc) => {
			await new Promise<void>((resolve) => (finishWrite = resolve));
			state.writes.push(structuredClone(next));
			state.disk = structuredClone(next);
		});
		state.memory.defaultVolume = 0.5;
		writer.request();
		await vi.waitFor(() => expect(access.write).toHaveBeenCalledTimes(1));

		state.memory.defaultVolume = 0.25;
		writer.request();
		writer.request();
		finishWrite();

		await vi.waitFor(() => expect(state.writes).toHaveLength(2));
		expect(state.writes[1].defaultVolume).toBe(0.25);
	});

	it("saves playback progress at most every 10 s", async () => {
		const { clock, state, writer } = setup();
		state.memory.playedEpisodes["Pod::Ep"] = { time: 20 };
		writer.checkpoint(() => writer.request());
		expect(clock.delays).toEqual([0]);
		clock.runAll();
		await vi.waitFor(() => expect(state.writes).toHaveLength(1));

		clock.advance(4000);
		state.memory.playedEpisodes["Pod::Ep"] = { time: 25 };
		writer.checkpoint(() => writer.request());

		expect(clock.delays).toEqual([0, 6000]);
		expect(state.writes).toHaveLength(1);
	});

	it("writes waiting progress with any other change, at once", async () => {
		const { clock, state, writer } = setup();
		await writer.save();
		state.memory.playedEpisodes["Pod::Ep"] = { time: 20 };
		writer.checkpoint(() => writer.request());
		state.memory.playedEpisodes["Pod::Ep"] = { time: 25 };
		writer.checkpoint(() => writer.request());

		state.memory.defaultVolume = 0.5;
		writer.request();
		await vi.waitFor(() => expect(state.writes).toHaveLength(1));

		expect(state.writes[0]).toMatchObject({
			defaultVolume: 0.5,
			playedEpisodes: { "Pod::Ep": { time: 25 } },
		});
		expect(clock.pending()).toBe(0);
	});

	it("waits 10 s after a save that was still writing when the checkpoint came", async () => {
		const { access, clock, state, writer } = setup();
		let finishWrite = () => {};
		access.write.mockImplementationOnce(async (next: Doc) => {
			await new Promise<void>((resolve) => (finishWrite = resolve));
			state.disk = structuredClone(next);
		});
		state.memory.defaultVolume = 0.5;
		const saving = writer.save();
		await vi.waitFor(() => expect(access.write).toHaveBeenCalledTimes(1));

		clock.advance(100);
		state.memory.playedEpisodes["Pod::Ep"] = { time: 20 };
		writer.checkpoint(() => writer.request());
		finishWrite();
		await saving;

		expect(clock.delays).toEqual([9900]);
	});

	it("starts a checkpoint 10 s after the last save even when it waited behind other work", async () => {
		const { access, clock, state, writer } = setup();
		state.memory.defaultVolume = 0.5;
		await writer.save();
		let releaseRead = () => {};
		access.read.mockImplementationOnce(
			() =>
				new Promise(
					(resolve) => (releaseRead = () => resolve(structuredClone(state.disk))),
				),
		);
		const external = writer.onExternalChange();
		await vi.waitFor(() => expect(access.read).toHaveBeenCalledTimes(2));

		clock.advance(5000);
		state.memory.playedEpisodes["Pod::Ep"] = { time: 20 };
		writer.checkpoint(() => writer.request());
		clock.advance(5000);
		clock.runAll();
		writer.checkpoint(() => writer.request());
		releaseRead();
		await external;
		await vi.waitFor(() => expect(state.writes).toHaveLength(2));

		state.memory.playedEpisodes["Pod::Ep"] = { time: 25 };
		clock.advance(1000);
		clock.runAll();
		await writer.onExternalChange();

		expect(state.writes).toHaveLength(2);
		expect(clock.delays).toEqual([5000, 0, 9000]);
	});

	it("reads and writes nothing while memory equals what it last loaded or wrote", async () => {
		const { access, state, writer } = setup();

		await writer.save();

		expect(access.read).not.toHaveBeenCalled();
		expect(state.writes).toHaveLength(0);
	});

	it("keeps a feed another device added when this device saves its own change (#357)", async () => {
		const { state, writer } = setup();
		state.memory.defaultVolume = 0.5;
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		await writer.save();

		const expected = { ...doc(), defaultVolume: 0.5 };
		expected.savedFeeds.Synced = { title: "Synced" };
		expect(state.writes).toEqual([expected]);
		// Memory holds the synced feed too, or the next save would read its absence as a deletion.
		expect(state.memory).toEqual(expected);
	});

	it("keeps an edit made during the write on top of what it wrote, and saves it next", async () => {
		const { access, state, writer } = setup();
		state.memory.defaultVolume = 0.5;
		state.disk!.savedFeeds.Synced = { title: "Synced" };
		access.write.mockImplementationOnce(async (next: Doc) => {
			state.memory.playedEpisodes["Pod::Ep"] = { time: 42 };
			state.writes.push(structuredClone(next));
			state.disk = structuredClone(next);
		});

		await writer.save();
		expect(state.writes[0].playedEpisodes["Pod::Ep"]).toEqual({ time: 10 });
		expect(state.memory).toMatchObject({
			defaultVolume: 0.5,
			savedFeeds: { Synced: { title: "Synced" } },
			playedEpisodes: { "Pod::Ep": { time: 42 } },
		});

		await writer.save();
		expect(state.writes[1]).toEqual(state.memory);
	});

	it("leaves memory untouched when the write fails", async () => {
		const { access, state, writer } = setup();
		access.write.mockRejectedValueOnce(new Error("disk full"));
		state.memory.defaultVolume = 0.5;
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		await expect(writer.save()).rejects.toThrow("disk full");

		expect(state.published).toHaveLength(0);
		expect(state.memory.savedFeeds.Synced).toBeUndefined();
	});

	it("writes memory back over a write that failed after it reached disk", async () => {
		const { access, state, writer } = setup();
		access.write.mockImplementationOnce(async (next: Doc) => {
			state.disk = structuredClone(next);
			throw new Error("could not verify");
		});
		state.memory.defaultVolume = 0.5;
		await expect(writer.save()).rejects.toThrow("could not verify");

		// A failed import puts the previous settings back and saves them.
		state.memory.defaultVolume = 1;
		await writer.save();

		expect(state.disk).toEqual(doc());
	});

	it("keeps a rollback when the file a failed write reached is reported as changed", async () => {
		const { access, state, writer } = setup();
		access.write.mockImplementationOnce(async (next: Doc) => {
			state.disk = structuredClone(next);
			throw new Error("could not verify");
		});
		state.memory.defaultVolume = 0.5;
		await expect(writer.save()).rejects.toThrow("could not verify");

		state.memory.defaultVolume = 1;
		await writer.onExternalChange();
		await writer.save();

		expect(state.memory).toEqual(doc());
		expect(state.disk).toEqual(doc());
	});

	it("keeps a removal made after a change reported elsewhere showed a failed write reached disk", async () => {
		const { access, state, writer } = setup();
		access.write.mockImplementationOnce(async (next: Doc) => {
			state.disk = structuredClone(next);
			throw new Error("could not verify");
		});
		state.memory.defaultVolume = 0.5;
		state.disk!.savedFeeds.Synced = { title: "Synced" };
		await expect(writer.save()).rejects.toThrow("could not verify");

		await writer.onExternalChange();
		delete state.memory.savedFeeds.Synced;
		await writer.save();

		expect(state.memory.savedFeeds.Synced).toBeUndefined();
		expect(state.disk!.savedFeeds.Synced).toBeUndefined();
	});

	it("keeps a change made elsewhere that a failed write carried to disk", async () => {
		const { access, state, writer } = setup();
		access.write.mockImplementationOnce(async (next: Doc) => {
			state.disk = structuredClone(next);
			throw new Error("could not verify");
		});
		state.memory.defaultVolume = 0.5;
		state.disk!.savedFeeds.Synced = { title: "Synced" };
		await expect(writer.save()).rejects.toThrow("could not verify");

		state.memory.defaultVolume = 0.25;
		await writer.save();

		expect(state.disk).toMatchObject({
			defaultVolume: 0.25,
			savedFeeds: { Synced: { title: "Synced" } },
		});
		expect(state.memory).toEqual(state.disk);
	});

	it("writes a failed write's changes from elsewhere again when it left nothing on disk", async () => {
		const { access, state, writer } = setup();
		access.write.mockImplementationOnce(async () => {
			state.disk = null;
			throw new Error("disk full");
		});
		state.memory.defaultVolume = 0.5;
		state.disk!.savedFeeds.Synced = { title: "Synced" };
		await expect(writer.save()).rejects.toThrow("disk full");

		state.memory.defaultVolume = 0.25;
		await writer.save();

		expect(state.disk).toMatchObject({
			defaultVolume: 0.25,
			savedFeeds: { Synced: { title: "Synced" } },
		});
		expect(state.memory).toEqual(state.disk);
	});

	it("writes nothing over a file it cannot read, even after a failed write", async () => {
		const { access, state, writer } = setup();
		access.write.mockRejectedValueOnce(new Error("disk full"));
		state.memory.defaultVolume = 0.5;
		await expect(writer.save()).rejects.toThrow("disk full");

		access.read.mockRejectedValue(new Error("newer schema"));
		await expect(writer.save()).rejects.toThrow("newer schema");

		expect(access.write).toHaveBeenCalledTimes(1);
	});

	it("never mistakes progress it took from disk for an edit made here", async () => {
		const { state, writer } = setup();
		state.memory.defaultVolume = 0.5;
		state.disk!.playedEpisodes["Pod::Ep"] = { time: 20 };
		await writer.save();

		state.memory.defaultVolume = 0.25;
		state.disk!.playedEpisodes["Pod::Ep"] = { time: 30 };
		await writer.save();

		expect(state.writes[1].playedEpisodes["Pod::Ep"]).toEqual({ time: 30 });
		expect(state.memory.playedEpisodes["Pod::Ep"]).toEqual({ time: 30 });
	});

	it("schedules no save when the store bindings ask for one while a save publishes", async () => {
		const { clock, state, writer } = setup();
		state.onPublish = () => writer.request();
		state.memory.defaultVolume = 0.5;
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		await writer.save();

		expect(state.published).toHaveLength(1);
		expect(clock.pending()).toBe(0);
	});

	it("writes memory as is when the file is missing", async () => {
		const { state, writer } = setup();
		state.memory.defaultVolume = 0.5;
		state.disk = null;

		await writer.save();

		expect(state.writes).toEqual([{ ...doc(), defaultVolume: 0.5 }]);
	});

	it("rejects a strict save when the write fails, and logs a requested one", async () => {
		const { access, state, writer } = setup();
		const failure = new Error("disk full");
		access.write.mockRejectedValue(failure);
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		state.memory.defaultVolume = 0.5;

		await expect(writer.save()).rejects.toBe(failure);

		writer.request();
		await writer.flush();
		expect(consoleError).toHaveBeenCalledWith("PodNotes: failed to save settings", failure);
	});
});

describe("DataFileWriter changes made elsewhere", () => {
	it("applies a change made elsewhere to memory and writes nothing back", async () => {
		const { clock, state, writer } = setup();
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		await writer.onExternalChange();

		expect(state.memory.savedFeeds.Synced).toEqual({ title: "Synced" });
		expect(clock.pending()).toBe(0);
		expect(state.writes).toHaveLength(0);
	});

	it("merges progress not saved yet with a change made elsewhere, and saves both", async () => {
		const { clock, state, writer } = setup();
		state.memory.playedEpisodes["Pod::Ep"] = { time: 42 };
		writer.checkpoint(() => writer.request());
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		await writer.onExternalChange();
		expect(state.memory).toMatchObject({
			playedEpisodes: { "Pod::Ep": { time: 42 } },
			savedFeeds: { Synced: {} },
		});

		await writer.flush();
		expect(state.writes).toEqual([state.memory]);
		expect(clock.pending()).toBe(0);
	});

	it("leaves no save pending when a store binding asks for one while memory takes the file", async () => {
		const { clock, state, writer } = setup();
		state.onPublish = () => writer.request();
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		await writer.onExternalChange();

		expect(state.published).toHaveLength(1);
		expect(clock.pending()).toBe(0);
	});

	it("leaves memory alone when the file is missing or cannot be read", async () => {
		const { access, state, writer } = setup();
		const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		state.disk = null;
		await writer.onExternalChange();

		access.read.mockRejectedValueOnce(new SyntaxError("Unexpected end of JSON input"));
		await writer.onExternalChange();

		expect(state.published).toHaveLength(0);
		expect(consoleWarn).toHaveBeenCalledTimes(1);
	});

	it("adopts the file when it had nothing to merge against", async () => {
		const file = memoryFile();
		const writer = new DataFileWriter<Doc>(file.access, manualClock(), null);
		file.state.memory.defaultVolume = 0.3;
		file.state.disk!.savedFeeds.Synced = { title: "Synced" };

		await writer.onExternalChange();

		expect(file.state.memory).toEqual(file.state.disk);
		await writer.save();
		expect(file.access.write).not.toHaveBeenCalled();
	});
});

describe("DataFileWriter lifecycle", () => {
	it("drops a change read after unload", async () => {
		const { access, state, writer } = setup();
		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		access.read.mockImplementationOnce(async () => {
			await held;
			return structuredClone(state.disk);
		});
		state.disk!.savedFeeds.Synced = { title: "Synced" };
		const external = writer.onExternalChange();

		const unloading = writer.unload();
		release();
		await Promise.all([external, unloading]);

		expect(state.published).toHaveLength(0);
	});

	it("still merges with disk when unload writes waiting progress", async () => {
		const { clock, state, writer } = setup();
		state.memory.playedEpisodes["Pod::Ep"] = { time: 42 };
		writer.checkpoint(() => writer.request());
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		await writer.unload();

		const expected = doc();
		expected.playedEpisodes["Pod::Ep"] = { time: 42 };
		expected.savedFeeds.Synced = { title: "Synced" };
		expect(state.writes).toEqual([expected]);
		expect(clock.pending()).toBe(0);
	});

	it("retries a save whose write failed when flushed, as on hide or unload", async () => {
		const { access, state, writer } = setup();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		access.write.mockRejectedValueOnce(new Error("disk full"));
		state.memory.defaultVolume = 0.5;
		writer.request();
		await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());
		expect(state.disk!.defaultVolume).toBe(1);

		await writer.flush();

		expect(state.disk!.defaultVolume).toBe(0.5);
	});

	it("writes an edit whose save could not read the file when flushed", async () => {
		const { access, state, writer } = setup();
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
		access.read.mockRejectedValueOnce(new Error("busy"));
		state.memory.defaultVolume = 0.5;
		writer.request();
		await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

		await writer.flush();

		expect(state.disk!.defaultVolume).toBe(0.5);
	});
});
