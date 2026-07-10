export type UnknownRecord = Record<string, unknown>;

export const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function readString(
	record: UnknownRecord,
	key: string,
	fallback: string,
	warnings: Set<string>,
	basePath = "",
): string {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value === "string") return value;
	warn(warnings, joinPath(basePath, key), "expected a string");
	return fallback;
}

export function readNullableString(
	record: UnknownRecord,
	key: string,
	warnings: Set<string>,
	basePath: string,
): string | null | undefined {
	const value = record[key];
	if (value === undefined || value === null || typeof value === "string") return value;
	warn(warnings, joinPath(basePath, key), "expected a string");
	return undefined;
}

export function readBoolean(
	record: UnknownRecord,
	key: string,
	fallback: boolean,
	warnings: Set<string>,
	basePath = "",
): boolean {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value === "boolean") return value;
	warn(warnings, joinPath(basePath, key), "expected a boolean");
	return fallback;
}

export function readFiniteNumber(
	record: UnknownRecord,
	key: string,
	fallback: number,
	warnings: Set<string>,
	basePath = "",
): number {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	warn(warnings, joinPath(basePath, key), "expected a finite number");
	return fallback;
}

export function readNonNegativeNumber(
	record: UnknownRecord,
	key: string,
	fallback: number,
	warnings: Set<string>,
	basePath: string,
): number {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	warn(warnings, joinPath(basePath, key), "expected a non-negative number");
	return fallback;
}

export function readPositiveNumber(
	record: UnknownRecord,
	key: string,
	fallback: number,
	warnings: Set<string>,
	basePath: string,
): number {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
	warn(warnings, joinPath(basePath, key), "expected a positive number");
	return fallback;
}

export function readClampedNumber(
	record: UnknownRecord,
	key: string,
	fallback: number,
	minimum: number,
	maximum: number,
	warnings: Set<string>,
): number {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isFinite(value)) {
		warn(warnings, key, "expected a finite number");
		return fallback;
	}
	const clamped = Math.min(maximum, Math.max(minimum, value));
	if (clamped !== value) warn(warnings, key, "value was clamped");
	return clamped;
}

export function setOptionalString(
	target: UnknownRecord,
	source: UnknownRecord,
	key: string,
	warnings: Set<string>,
	basePath: string,
): void {
	const value = source[key];
	if (value === undefined || value === null) {
		delete target[key];
	} else if (typeof value === "string") {
		target[key] = value;
	} else {
		delete target[key];
		warn(warnings, joinPath(basePath, key), "expected a string");
	}
}

export function setOptionalFiniteNumber(
	target: UnknownRecord,
	source: UnknownRecord,
	key: string,
	warnings: Set<string>,
	basePath: string,
	minimum: number,
): void {
	const value = source[key];
	if (value === undefined || value === null) {
		delete target[key];
	} else if (typeof value === "number" && Number.isFinite(value) && value >= minimum) {
		target[key] = value;
	} else {
		delete target[key];
		warn(warnings, joinPath(basePath, key), `expected a finite number >= ${minimum}`);
	}
}

export function optionalRecord(value: unknown, warnings: Set<string>, path: string): UnknownRecord {
	if (value === undefined || value === null) return {};
	if (isPlainObject(value)) return value;
	warn(warnings, path, "expected an object");
	return {};
}

export function copySafeObject(value: UnknownRecord): UnknownRecord {
	const copy: UnknownRecord = {};
	for (const [key, field] of Object.entries(value)) {
		if (!DANGEROUS_KEYS.has(key)) copy[key] = field;
	}
	return copy;
}

export function safeEntries(
	value: UnknownRecord,
	warnings: Set<string>,
	path: string,
): [string, unknown][] {
	const entries: [string, unknown][] = [];
	for (const [key, field] of Object.entries(value)) {
		if (DANGEROUS_KEYS.has(key)) {
			warn(warnings, `${path}.${key}`, "unsafe key was removed");
			continue;
		}
		entries.push([key, field]);
	}
	return entries;
}

export function mapRecord<T, R>(
	value: Record<string, T>,
	mapper: (entry: T) => R,
): Record<string, R> {
	const result: Record<string, R> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (!DANGEROUS_KEYS.has(key)) result[key] = mapper(entry);
	}
	return result;
}

export function isPlainObject(value: unknown): value is UnknownRecord {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function warn(warnings: Set<string>, path: string, reason: string): void {
	warnings.add(`${path}: ${reason}`);
}

function joinPath(basePath: string, key: string): string {
	return basePath ? `${basePath}.${key}` : key;
}
