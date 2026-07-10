const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const textEncoder = new TextEncoder();

export type StrictDataRecord = Record<string, unknown>;

function snapshotDataRecordInternal(
	value: unknown,
	allowedKeys?: ReadonlySet<string>,
	maximumKeys = Number.MAX_SAFE_INTEGER,
): StrictDataRecord | null {
	try {
		if (
			typeof value !== "object" ||
			value === null ||
			Array.isArray(value) ||
			!Number.isSafeInteger(maximumKeys) ||
			maximumKeys < 0
		) {
			return null;
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) return null;

		const ownKeys = Reflect.ownKeys(value);
		if (ownKeys.length > maximumKeys) return null;
		const snapshot = Object.create(null) as StrictDataRecord;
		for (const key of ownKeys) {
			if (
				typeof key !== "string" ||
				DANGEROUS_KEYS.has(key) ||
				(allowedKeys && !allowedKeys.has(key))
			) {
				return null;
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			snapshot[key] = descriptor.value;
		}
		return snapshot;
	} catch {
		return null;
	}
}

/** Snapshot any bounded plain-data record once, including proxy descriptors. */
export function snapshotPlainDataRecord(
	value: unknown,
	maximumKeys = Number.MAX_SAFE_INTEGER,
): StrictDataRecord | null {
	return snapshotDataRecordInternal(value, undefined, maximumKeys);
}

/** Snapshot a plain-data record whose keys must be drawn from the allowlist. */
export function snapshotAllowedDataRecord(
	value: unknown,
	allowedKeys: ReadonlySet<string>,
): StrictDataRecord | null {
	return snapshotDataRecordInternal(value, allowedKeys, allowedKeys.size);
}

/**
 * Copy an exact plain-data object without invoking accessors or retaining a
 * hostile proxy/object reference. Every expected key must exist exactly once.
 */
export function snapshotStrictDataRecord(
	value: unknown,
	expectedKeys: readonly string[],
): StrictDataRecord | null {
	const expected = new Set(expectedKeys);
	if (expected.size !== expectedKeys.length) return null;
	const snapshot = snapshotDataRecordInternal(value, expected, expected.size);
	return snapshot &&
		expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(snapshot, key))
		? snapshot
		: null;
}

/** Snapshot a dense data-only array without retaining a proxy or invoking getters. */
export function snapshotDenseDataArray(value: unknown, maximumLength: number): unknown[] | null {
	try {
		if (!Array.isArray(value) || !Number.isSafeInteger(maximumLength) || maximumLength < 0) {
			return null;
		}
		const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
		if (!lengthDescriptor || !("value" in lengthDescriptor)) return null;
		const length = lengthDescriptor.value;
		if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return null;
		const ownKeys = Reflect.ownKeys(value);
		const ownKeySet = new Set(ownKeys);
		if (ownKeySet.size !== length + 1 || !ownKeySet.has("length")) return null;

		const snapshot: unknown[] = [];
		for (let index = 0; index < length; index += 1) {
			const key = String(index);
			if (!ownKeySet.has(key)) return null;
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor?.enumerable || !("value" in descriptor)) return null;
			snapshot.push(descriptor.value);
		}
		return snapshot;
	} catch {
		return null;
	}
}

export function utf8ByteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}

export function serializedValueFits(value: unknown, maximumBytes: number): boolean {
	try {
		const serialized = JSON.stringify(value);
		return typeof serialized === "string" && utf8ByteLength(serialized) <= maximumBytes;
	} catch {
		return false;
	}
}
