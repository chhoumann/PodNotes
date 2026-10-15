import { afterEach, describe, expect, it, vi } from "vitest";
import { manualClock } from "../../tests/mocks/dataFileWriter";
import {
	type DataFileAccess,
	DataFileWriter,
	type ReadOutcome,
	type Refusal,
	type WriteOutcome,
	type WriterStart,
} from "./writer";

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

const STARTUP: Refusal = { recovery: "retry", message: "could not read at startup" };
const UNREADABLE: Refusal = { recovery: "retry", message: "could not read" };
const NEWER: Refusal = { recovery: "stop", message: "update PodNotes" };

function found(disk: Doc | null): ReadOutcome<Doc> {
	return disk ? { kind: "file", doc: structuredClone(disk) } : { kind: "missing" };
}

function refused(refusal: Refusal): ReadOutcome<Doc> {
	return { kind: "refused", refusal };
}

const VERIFIED: WriteOutcome<Doc> = { kind: "verified" };

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

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
		read: vi.fn(async (): Promise<ReadOutcome<Doc>> => found(state.disk)),
		write: vi.fn(async (next: Doc): Promise<WriteOutcome<Doc>> => {
			state.writes.push(structuredClone(next));
			state.disk = structuredClone(next);
			return VERIFIED;
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

function setup(initial: Doc = doc(), start: WriterStart<Doc> = { base: structuredClone(initial) }) {
	const file = memoryFile(initial);
	const clock = manualClock();
	const events = { onRefusal: vi.fn(), onWriteFailed: vi.fn() };
	const writer = new DataFileWriter<Doc>(file.access, clock, start, events);
	return { ...file, clock, events, writer };
}

function replacedWith(
	state: ReturnType<typeof memoryFile>["state"],
	replacement: (before: Doc, written: Doc) => Doc,
) {
	return async (next: Doc): Promise<WriteOutcome<Doc>> => {
		state.writes.push(structuredClone(next));
		state.disk = replacement(structuredClone(state.disk!), structuredClone(next));
		return { kind: "different", doc: structuredClone(state.disk) };
	};
}

function withFeed(file: Doc, title: string): Doc {
	file.savedFeeds[title] = { title };
	return file;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("adopted documents that need a rewrite", () => {
	it("rereads before writing and waits when the file becomes unreadable", async () => {
		const { access, clock, state, writer } = setup();
		const protectedRead = { kind: "file" as const, doc: doc(), rewrite: true };
		access.read.mockResolvedValueOnce(protectedRead).mockResolvedValueOnce(refused(UNREADABLE));
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await writer.onExternalChange();
		await settled();

		expect(access.read).toHaveBeenCalledTimes(2);
		expect(state.writes).toEqual([]);
		expect(clock.pending()).toBe(1);
		clock.advance(10_000);
		clock.runAll();
		await settled();
		expect(state.writes).toEqual([doc()]);
	});

	it("keeps rewrite work through a failed write and retries it once", async () => {
		const { access, clock, state, writer } = setup();
		const protectedRead = { kind: "file" as const, doc: doc(), rewrite: true };
		access.read.mockResolvedValueOnce(protectedRead).mockResolvedValueOnce(protectedRead);
		access.write.mockRejectedValueOnce(new Error("disk full"));
		vi.spyOn(console, "error").mockImplementation(() => undefined);

		await writer.onExternalChange();
		await settled();

		expect(access.write).toHaveBeenCalledTimes(1);
		expect(state.writes).toEqual([]);
		clock.advance(10_000);
		clock.runAll();
		await settled();
		expect(state.writes).toEqual([doc()]);
		await writer.onExternalChange();
		await writer.flush();
		expect(access.write).toHaveBeenCalledTimes(2);
	});
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
			return VERIFIED;
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
			return VERIFIED;
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
			() => new Promise((resolve) => (releaseRead = () => resolve(found(state.disk)))),
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
			return VERIFIED;
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
		const { access, clock, state, writer } = setup();
		access.write.mockRejectedValueOnce(new Error("disk full"));
		state.memory.defaultVolume = 0.5;
		await expect(writer.save()).rejects.toThrow("disk full");

		access.read.mockResolvedValue(refused(NEWER));
		await expect(writer.save()).rejects.toThrow("update PodNotes");

		expect(access.write).toHaveBeenCalledTimes(1);
		expect(clock.pending()).toBe(0);
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

describe("DataFileWriter saves another writer replaced", () => {
	it("takes in the file a sync client put in place of a save and writes the merge once", async () => {
		const { access, clock, events, state, writer } = setup();
		access.write.mockImplementationOnce(
			replacedWith(state, (before) => withFeed(before, "Synced")),
		);
		state.memory.defaultVolume = 0.5;

		writer.request();
		await writer.flush();

		const merged = withFeed({ ...doc(), defaultVolume: 0.5 }, "Synced");
		expect(state.writes).toEqual([{ ...doc(), defaultVolume: 0.5 }, merged]);
		expect(state.disk).toEqual(merged);
		expect(state.memory).toEqual(merged);
		expect(events.onWriteFailed).not.toHaveBeenCalled();
		expect(clock.pending()).toBe(0);
	});

	it("fails a save that left the file as it was, even when that differs from what it loaded", async () => {
		const { access, clock, events, state, writer } = setup();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const before = withFeed(doc(), "Synced");
		state.disk = structuredClone(before);
		// Obsidian's saveData resolves even when its write fails.
		access.write.mockImplementationOnce(async () => ({
			kind: "different",
			doc: structuredClone(before),
		}));
		state.memory.defaultVolume = 0.5;

		writer.request();
		await writer.flush();
		expect(events.onWriteFailed).toHaveBeenCalledTimes(1);
		expect(access.write).toHaveBeenCalledTimes(1);
		expect(state.published).toHaveLength(0);
		expect(clock.delays).toEqual([10_000]);

		clock.advance(10_000);
		clock.runAll();
		await writer.flush();
		expect(state.disk).toEqual({ ...before, defaultVolume: 0.5 });
		expect(state.memory).toEqual(state.disk);
	});

	it("keeps edits made during a replaced save, even one undoing the edit it wrote", async () => {
		const { access, state, writer } = setup();
		access.write.mockImplementationOnce(
			replacedWith(state, (_, written) => {
				state.memory.defaultVolume = 1;
				state.memory.playedEpisodes["Pod::Ep"] = { time: 42 };
				return withFeed(written, "Synced");
			}),
		);
		state.memory.defaultVolume = 0.5;

		await writer.save();

		const expected = withFeed(doc(), "Synced");
		expected.playedEpisodes["Pod::Ep"] = { time: 42 };
		expect(state.memory).toEqual(expected);
		expect(state.disk).toEqual(expected);
	});

	it("finishes a strict save through every replacement in a row", async () => {
		const { access, state, writer } = setup();
		for (const title of ["A", "B", "C"]) {
			access.write.mockImplementationOnce(
				replacedWith(state, (before) => withFeed(before, title)),
			);
		}
		state.memory.defaultVolume = 0.5;

		await writer.save();

		const expected = ["A", "B", "C"].reduce(withFeed, { ...doc(), defaultVolume: 0.5 });
		expect(state.writes).toHaveLength(4);
		expect(state.disk).toEqual(expected);
		expect(state.memory).toEqual(expected);
	});

	it("writes nothing more when the file that replaced a save already holds its edit", async () => {
		const { access, state, writer } = setup();
		access.write.mockImplementationOnce(
			replacedWith(state, (_, written) => withFeed(written, "Synced")),
		);
		state.memory.defaultVolume = 0.5;

		await writer.save();
		await writer.save();

		expect(state.writes).toHaveLength(1);
		expect(state.memory).toEqual(withFeed({ ...doc(), defaultVolume: 0.5 }, "Synced"));
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
		const { access, events, state, writer } = setup();
		state.disk = null;
		await writer.onExternalChange();

		access.read.mockResolvedValueOnce(refused(UNREADABLE));
		await writer.onExternalChange();

		expect(state.published).toHaveLength(0);
		expect(state.writes).toHaveLength(0);
		expect(events.onRefusal.mock.calls).toEqual([[UNREADABLE]]);
	});

	it("reads the file once the changes reported to it settle", async () => {
		const { access, clock, state, writer } = setup();
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		writer.report();
		writer.report();
		expect(access.read).not.toHaveBeenCalled();
		expect(clock.pending()).toBe(1);
		clock.runAll();
		await writer.flush();

		expect(access.read).toHaveBeenCalledTimes(1);
		expect(state.memory.savedFeeds.Synced).toEqual({ title: "Synced" });
	});

	it("reads nothing for a change reported before unload", async () => {
		const { access, clock, state, writer } = setup();
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		writer.report();
		await writer.unload();
		writer.report();
		clock.runAll();
		await settled();

		expect(access.read).not.toHaveBeenCalled();
	});

	it("adopts the file when it had nothing to merge against", async () => {
		const { access, events, state, writer } = setup(doc(), { base: null, refusal: STARTUP });
		state.memory.defaultVolume = 0.3;
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		await writer.onExternalChange();

		expect(state.memory).toEqual(state.disk);
		expect(events.onRefusal.mock.calls).toEqual([[null]]);
		await writer.save();
		expect(access.write).not.toHaveBeenCalled();
	});
});

describe("DataFileWriter refusals", () => {
	it("reads and writes nothing before a file was loaded, even when flushed or unloaded", async () => {
		const { access, clock, state, writer } = setup(doc(), { base: null, refusal: STARTUP });
		state.memory.defaultVolume = 0.5;

		writer.request();
		writer.checkpoint(() => writer.request());
		await writer.flush();
		expect(clock.pending()).toBe(0);
		await expect(writer.save()).rejects.toThrow("could not read at startup");
		await writer.unload();

		expect(access.read).not.toHaveBeenCalled();
		expect(state.writes).toHaveLength(0);
	});

	it("keeps refusing before a file was loaded when the file is missing, empty or unreadable", async () => {
		const { access, events, state, writer } = setup(doc(), { base: null, refusal: STARTUP });
		state.memory.defaultVolume = 0.5;
		state.disk = null;
		await writer.onExternalChange();
		access.read.mockResolvedValueOnce(refused(UNREADABLE));
		await writer.onExternalChange();

		await expect(writer.save()).rejects.toThrow("could not read at startup");
		await writer.flush();
		expect(access.read).toHaveBeenCalledTimes(2);
		expect(state.writes).toHaveLength(0);
		expect(events.onRefusal).not.toHaveBeenCalled();
	});

	it("replaces startup protection with a schema stop and reads no further", async () => {
		const { access, clock, events, state, writer } = setup(doc(), {
			base: null,
			refusal: STARTUP,
		});
		state.memory.defaultVolume = 0.5;
		access.read.mockResolvedValue(refused(NEWER));
		await writer.onExternalChange();
		await writer.onExternalChange();
		writer.request();
		await writer.flush();

		await expect(writer.save()).rejects.toThrow("update PodNotes");
		expect(access.read).toHaveBeenCalledTimes(1);
		expect(state.writes).toHaveLength(0);
		expect(clock.pending()).toBe(0);
		expect(events.onRefusal.mock.calls).toEqual([[NEWER]]);
	});

	it("retries a refused read 10 s after the last attempt, also with edits, and writes once it reads", async () => {
		const { access, clock, events, state, writer } = setup();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		access.read.mockResolvedValue(refused(UNREADABLE));
		clock.advance(60_000);
		await writer.onExternalChange();
		expect(clock.delays).toEqual([10_000]);

		clock.advance(5_000);
		state.memory.defaultVolume = 0.5;
		writer.request();
		await settled();
		expect(access.read).toHaveBeenCalledTimes(1);

		clock.advance(5_000);
		clock.runAll();
		await settled();
		expect(access.read).toHaveBeenCalledTimes(2);
		expect(clock.delays).toEqual([10_000, 10_000]);

		access.read.mockImplementation(async () => found(state.disk));
		clock.advance(10_000);
		clock.runAll();
		await settled();
		expect(state.writes).toEqual([{ ...doc(), defaultVolume: 0.5 }]);
		expect(events.onRefusal.mock.calls).toEqual([[UNREADABLE], [null]]);
		expect(clock.pending()).toBe(0);
	});

	it("writes the library once when the file reads as missing again, even without an edit", async () => {
		const { access, clock, state, writer } = setup();
		access.read.mockResolvedValueOnce(refused(UNREADABLE));
		await writer.onExternalChange();
		state.disk = null;

		await writer.onExternalChange();
		expect(state.writes).toEqual([doc()]);

		clock.advance(10_000);
		clock.runAll();
		await writer.flush();
		await writer.onExternalChange();
		expect(access.write).toHaveBeenCalledTimes(1);
	});

	it("writes the library again when its recovery write fails", async () => {
		const { access, clock, events, state, writer } = setup();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		access.read.mockResolvedValueOnce(refused(UNREADABLE));
		await writer.onExternalChange();
		state.disk = null;
		access.write.mockRejectedValueOnce(new Error("disk full"));

		clock.advance(10_000);
		clock.runAll();
		await settled();
		expect(state.disk).toBeNull();
		expect(events.onWriteFailed).toHaveBeenCalledTimes(1);

		clock.advance(10_000);
		clock.runAll();
		await settled();
		expect(state.disk).toEqual(doc());
		expect(access.write).toHaveBeenCalledTimes(2);
		expect(clock.pending()).toBe(0);
	});

	it("reports a refusal once per streak, and again after a recovery", async () => {
		const { access, events, state, writer } = setup();
		access.read.mockResolvedValue(refused(UNREADABLE));
		await writer.onExternalChange();
		await writer.onExternalChange();
		await expect(writer.save()).rejects.toThrow("could not read");

		access.read.mockImplementation(async () => found(state.disk));
		await writer.save();
		access.read.mockResolvedValue(refused(UNREADABLE));
		await writer.onExternalChange();

		expect(events.onRefusal.mock.calls).toEqual([[UNREADABLE], [null], [UNREADABLE]]);
	});

	it("stops for a schema it must not write: no checkpoint, read or write until the next instance", async () => {
		const { access, clock, events, state, writer } = setup();
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		access.read.mockResolvedValueOnce(refused(UNREADABLE));
		await writer.onExternalChange();
		let release = () => {};
		access.read.mockImplementationOnce(
			() => new Promise((resolve) => (release = () => resolve(refused(NEWER)))),
		);
		const external = writer.onExternalChange();
		const queuedSave = writer.save();
		const queuedExternal = writer.onExternalChange();
		await vi.waitFor(() => expect(access.read).toHaveBeenCalledTimes(2));
		state.memory.playedEpisodes["Pod::Ep"] = { time: 20 };
		writer.checkpoint(() => writer.request());
		expect(clock.pending()).toBe(1);
		release();
		await external;
		await expect(queuedSave).rejects.toThrow("update PodNotes");
		await queuedExternal;
		expect(clock.pending()).toBe(0);

		state.memory.defaultVolume = 0.5;
		writer.request();
		writer.checkpoint(() => writer.request());
		await writer.flush();
		await writer.onExternalChange();
		expect(clock.pending()).toBe(0);
		await expect(writer.save()).rejects.toThrow("update PodNotes");
		await writer.unload();

		expect(access.read).toHaveBeenCalledTimes(2);
		expect(state.writes).toHaveLength(0);
		expect(clock.pending()).toBe(0);
		expect(events.onRefusal.mock.calls).toEqual([[UNREADABLE], [NEWER]]);
	});
});

describe("DataFileWriter lifecycle", () => {
	it("drops a change read after unload", async () => {
		const { access, state, writer } = setup();
		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		access.read.mockImplementationOnce(async () => {
			await held;
			return found(state.disk);
		});
		state.disk!.savedFeeds.Synced = { title: "Synced" };
		const external = writer.onExternalChange();

		const unloading = writer.unload();
		release();
		await Promise.all([external, unloading]);

		expect(state.published).toHaveLength(0);
	});

	it("writes memory as it was at unload, not a change a later callback makes", async () => {
		const { access, state, writer } = setup();
		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		access.read.mockImplementationOnce(async () => {
			await held;
			return found(state.disk);
		});
		state.memory.defaultVolume = 0.5;

		const unloading = writer.unload();
		state.memory.playedEpisodes["Pod::Ep"] = { time: 99 };
		writer.request();
		release();
		await unloading;
		await writer.flush();

		expect(state.writes).toEqual([{ ...doc(), defaultVolume: 0.5 }]);
	});

	it("keeps a change made elsewhere that a save in flight at unload merged in", async () => {
		const { access, state, writer } = setup();
		let release = () => {};
		const held = new Promise<void>((resolve) => (release = resolve));
		access.read.mockImplementationOnce(async () => {
			await held;
			return found(state.disk);
		});
		state.memory.defaultVolume = 0.5;
		writer.request();
		await vi.waitFor(() => expect(access.read).toHaveBeenCalled());
		state.disk!.savedFeeds.Synced = { title: "Synced" };

		const unloading = writer.unload();
		release();
		await unloading;

		const expected = { ...doc(), defaultVolume: 0.5 };
		expected.savedFeeds.Synced = { title: "Synced" };
		expect(state.disk).toEqual(expected);
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
		access.read.mockResolvedValueOnce(refused(UNREADABLE));
		state.memory.defaultVolume = 0.5;
		writer.request();
		await vi.waitFor(() => expect(consoleError).toHaveBeenCalled());

		await writer.flush();

		expect(state.disk!.defaultVolume).toBe(0.5);
	});
});
