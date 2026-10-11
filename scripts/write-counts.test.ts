import { describe, expect, it } from "vitest";
import { installWriteRecorder } from "./write-counts.mjs";

describe("data.json write recorder", () => {
	it("counts exact-path UTF-8 writes, preserves arguments and this, and restores the descriptor", async () => {
		const calls: unknown[][] = [];
		const adapter = {
			async write(path: string, contents: string, ...rest: unknown[]) {
				expect(this).toBe(adapter);
				calls.push([path, contents, ...rest]);
				return "written";
			},
		};
		const original = Object.getOwnPropertyDescriptor(adapter, "write");
		const recorder = installWriteRecorder(adapter, "plugin/data.json");
		expect(await adapter.write("other/data.json", "ignored")).toBe("written");
		expect(await adapter.write("plugin/data.json", "雪", { mtime: 123 })).toBe("written");
		expect(calls).toEqual([
			["other/data.json", "ignored"],
			["plugin/data.json", "雪", { mtime: 123 }],
		]);
		expect(recorder.stop()).toMatchObject({
			attempted: 1,
			completed: 1,
			failed: 0,
			inflight: 0,
			completedBytes: 3,
			complete: true,
		});
		expect(Object.getOwnPropertyDescriptor(adapter, "write")).toEqual(original);
	});

	it("records rejected and synchronous adapter failures instead of claiming success", async () => {
		const failure = new Error("disk full");
		const adapter = { write: (_path: string, _contents: string) => Promise.reject(failure) };
		const recorder = installWriteRecorder(adapter, "data.json");
		await expect(adapter.write("data.json", "{}")).rejects.toBe(failure);
		expect(recorder.stop()).toMatchObject({
			attempted: 1,
			completed: 0,
			failed: 1,
			inflight: 0,
		});
		const synchronous = {
			write: (_path: string, _contents: string): Promise<void> => {
				throw failure;
			},
		};
		const second = installWriteRecorder(synchronous, "data.json");
		expect(() => synchronous.write("data.json", "{}")).toThrow(failure);
		expect(second.stop()).toMatchObject({ failed: 1, inflight: 0 });
	});

	it("refuses unfinished counts or replacing a different recorder's writer", async () => {
		let finish!: () => void;
		const adapter = {
			write: (_path: string, _contents: string) =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		};
		const recorder = installWriteRecorder(adapter, "data.json");
		const pending = adapter.write("data.json", "{}");
		expect(recorder.report().complete).toBe(false);
		expect(() => recorder.stop()).toThrow("pending writes");
		finish();
		await pending;
		const replacement = async () => undefined;
		adapter.write = replacement;
		expect(() => recorder.stop()).toThrow("writer changed");
		expect(adapter.write).toBe(replacement);
	});
});
