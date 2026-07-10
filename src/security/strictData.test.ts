import { describe, expect, it } from "vitest";
import {
	snapshotAllowedDataRecord,
	snapshotDenseDataArray,
	snapshotPlainDataRecord,
	snapshotStrictDataRecord,
} from "./strictData";

describe("snapshotStrictDataRecord", () => {
	it("copies exact Object and null-prototype data records", () => {
		const value = Object.assign(Object.create(null), { alpha: 1, beta: "two" });
		const result = snapshotStrictDataRecord(value, ["alpha", "beta"]);
		expect(result).toEqual({ alpha: 1, beta: "two" });
		expect(Object.getPrototypeOf(result!)).toBeNull();
	});

	it.each([
		null,
		[],
		new Date(),
		{ alpha: 1 },
		{ alpha: 1, beta: 2, extra: 3 },
		Object.assign(Object.create(null), { __proto__: "value", beta: 2 }),
	])("rejects a non-exact record %#", (value) => {
		expect(snapshotStrictDataRecord(value, ["alpha", "beta"])).toBeNull();
	});

	it("rejects accessors and symbols without invoking them", () => {
		let accessed = false;
		const value = Object.defineProperty({ beta: 2 }, "alpha", {
			enumerable: true,
			get() {
				accessed = true;
				return 1;
			},
		});
		Object.defineProperty(value, Symbol("hidden"), { enumerable: true, value: 3 });

		expect(snapshotStrictDataRecord(value, ["alpha", "beta"])).toBeNull();
		expect(accessed).toBe(false);
	});

	it("fails closed when a proxy trap throws", () => {
		const value = new Proxy(
			{},
			{
				ownKeys() {
					throw new Error("hostile proxy");
				},
			},
		);
		expect(snapshotStrictDataRecord(value, [])).toBeNull();
	});

	it("snapshots bounded and allowlisted records without rereading proxy getters", () => {
		let reads = 0;
		const value = new Proxy(
			{ alpha: 1, beta: 2 },
			{
				get(target, key, receiver) {
					reads += 1;
					return Reflect.get(target, key, receiver);
				},
			},
		);
		expect(snapshotPlainDataRecord(value, 2)).toEqual({ alpha: 1, beta: 2 });
		expect(snapshotAllowedDataRecord(value, new Set(["alpha", "beta"]))).toEqual({
			alpha: 1,
			beta: 2,
		});
		expect(snapshotPlainDataRecord(value, 1)).toBeNull();
		expect(snapshotAllowedDataRecord(value, new Set(["alpha"]))).toBeNull();
		expect(reads).toBe(0);
	});

	it("rejects dangerous data keys explicitly", () => {
		const value = Object.create(null) as Record<string, unknown>;
		Object.defineProperty(value, "__proto__", { enumerable: true, value: "poison" });
		expect(snapshotPlainDataRecord(value)).toBeNull();
	});

	it("snapshots only dense data arrays", () => {
		const value = ["one", "two"];
		expect(snapshotDenseDataArray(value, 2)).toEqual(value);
		expect(snapshotDenseDataArray(value, 1)).toBeNull();
		const sparse: string[] = [];
		sparse.length = 1;
		expect(snapshotDenseDataArray(sparse, 2)).toBeNull();
		const extra = ["one"] as string[] & { extra?: boolean };
		extra.extra = true;
		expect(snapshotDenseDataArray(extra, 2)).toBeNull();
	});

	it("does not invoke dense-array accessors", () => {
		let accessed = false;
		const value = ["one"];
		Object.defineProperty(value, "0", {
			enumerable: true,
			get() {
				accessed = true;
				return "one";
			},
		});
		expect(snapshotDenseDataArray(value, 1)).toBeNull();
		expect(accessed).toBe(false);
	});
});
