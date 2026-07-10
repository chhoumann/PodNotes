import {
	MAX_LIBRARY_V3_BYTES,
	MAX_TOTAL_TEXT_BYTES,
	MAX_VAULT_PATH_BYTES,
	type ValidationContext,
} from "./model";

export const INVALID = Symbol("invalid-library-v3-value");
export type Invalid = typeof INVALID;
export type UnknownRecord = Record<string, unknown>;

const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const RESERVED_VAULT_ROOTS = new Set([".obsidian", ".trash", ".git", ".hg", ".svn"]);
const WINDOWS_RESERVED_CHARACTERS = /[<>:"|?*]/;
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const textEncoder = new TextEncoder();

export function utf8ByteLength(value: string): number {
	return textEncoder.encode(value).byteLength;
}

export function serializedLibraryFits(value: unknown): boolean {
	try {
		const serialized = JSON.stringify(value);
		return typeof serialized === "string" && utf8ByteLength(serialized) <= MAX_LIBRARY_V3_BYTES;
	} catch {
		return false;
	}
}

export function isPlainDataRecord(value: unknown): value is UnknownRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return false;

	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== "string" || DANGEROUS_KEYS.has(key)) return false;
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !("value" in descriptor)) return false;
	}
	return true;
}

export function isStrictRecord(
	value: unknown,
	allowedKeys: ReadonlySet<string>,
): value is UnknownRecord {
	return isPlainDataRecord(value) && Object.keys(value).every((key) => allowedKeys.has(key));
}

export function hasOwn(record: UnknownRecord, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(record, key);
}

function hasInvalidUnicode(value: string, allowMultiline: boolean): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		const allowedWhitespace = allowMultiline && (code === 0x09 || code === 0x0a);
		if ((code <= 0x1f && !allowedWhitespace) || code === 0x7f) return true;
		if (
			(code >= 0x202a && code <= 0x202e) ||
			(code >= 0x2066 && code <= 0x2069) ||
			code === 0x200e ||
			code === 0x200f
		) {
			return true;
		}
		if (code >= 0xd800 && code <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
		} else if (code >= 0xdc00 && code <= 0xdfff) {
			return true;
		}
	}
	return false;
}

function looksLikeHtml(value: string): boolean {
	return /<(?:\/?[a-z][^>]*|!--|!doctype\b|\?xml\b)/i.test(value);
}

export function normalizeText(
	value: unknown,
	maximumBytes: number,
	context: ValidationContext,
	options: { multiline?: boolean; rejectHtml?: boolean } = {},
): string | Invalid {
	if (typeof value !== "string" || value.length === 0 || value.trim() !== value) return INVALID;
	if (value.normalize("NFC") !== value || value.includes("\r")) return INVALID;
	if (hasInvalidUnicode(value, options.multiline === true)) return INVALID;
	if (!options.multiline && (value.includes("\n") || value.includes("\t"))) return INVALID;
	if (options.rejectHtml && looksLikeHtml(value)) return INVALID;

	const bytes = utf8ByteLength(value);
	if (bytes > maximumBytes || context.textBytes + bytes > MAX_TOTAL_TEXT_BYTES) return INVALID;
	context.textBytes += bytes;
	return value;
}

export function optionalText(
	record: UnknownRecord,
	key: string,
	maximumBytes: number,
	context: ValidationContext,
	options: { multiline?: boolean; rejectHtml?: boolean } = {},
): string | undefined | Invalid {
	if (!hasOwn(record, key)) return undefined;
	return normalizeText(record[key], maximumBytes, context, options);
}

export function normalizeIsoDate(value: unknown): string | Invalid {
	if (typeof value !== "string") return INVALID;
	const match =
		/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(
			value,
		);
	if (!match) return INVALID;

	const [
		,
		yearText,
		monthText,
		dayText,
		hourText,
		minuteText,
		secondText,
		,
		,
		,
		offsetHourText,
		offsetMinuteText,
	] = match;
	const year = Number(yearText);
	const month = Number(monthText);
	const day = Number(dayText);
	const hour = Number(hourText);
	const minute = Number(minuteText);
	const second = Number(secondText);
	const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
	const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
	const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
	const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
		month - 1
	];
	if (
		year === 0 ||
		month < 1 ||
		month > 12 ||
		day < 1 ||
		daysInMonth === undefined ||
		day > daysInMonth ||
		hour > 23 ||
		minute > 59 ||
		second > 59 ||
		offsetHour > 23 ||
		offsetMinute > 59
	) {
		return INVALID;
	}

	const timestamp = Date.parse(value);
	if (!Number.isFinite(timestamp)) return INVALID;
	const canonical = new Date(timestamp).toISOString();
	// Offsets at the ISO-8601 boundary can move a four-digit input into year 0000
	// or the expanded +010000 form. Neither can be decoded by this schema again,
	// so reject them instead of emitting a non-idempotent representation.
	return /^(?!0000-)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(canonical)
		? canonical
		: INVALID;
}

export function optionalDate(record: UnknownRecord, key: string): string | undefined | Invalid {
	if (!hasOwn(record, key)) return undefined;
	return normalizeIsoDate(record[key]);
}

export function optionalNonNegativeNumber(
	record: UnknownRecord,
	key: string,
	integer: boolean,
): number | undefined | Invalid {
	if (!hasOwn(record, key)) return undefined;
	const value = record[key];
	if (
		typeof value !== "number" ||
		!Number.isFinite(value) ||
		value < 0 ||
		value > Number.MAX_SAFE_INTEGER ||
		(integer && !Number.isInteger(value))
	) {
		return INVALID;
	}
	return value;
}

export function compareCodeUnits(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function portableVaultPathOwnershipKey(value: string): string {
	return value.normalize("NFC").toLowerCase();
}

export function normalizeVaultPath(value: unknown, context: ValidationContext): string | Invalid {
	const path = normalizeText(value, MAX_VAULT_PATH_BYTES, context);
	if (path === INVALID) return INVALID;
	if (
		path.startsWith("/") ||
		path.startsWith("~") ||
		path.includes("\\") ||
		path.includes("//") ||
		path.endsWith("/") ||
		/^[a-z][a-z0-9+.-]*:/i.test(path)
	) {
		return INVALID;
	}

	const segments = path.split("/");
	if (
		RESERVED_VAULT_ROOTS.has(portableVaultPathOwnershipKey(segments[0] ?? "")) ||
		segments.some(
			(segment) =>
				segment.length === 0 ||
				segment === "." ||
				segment === ".." ||
				segment.trim() !== segment ||
				segment.endsWith(".") ||
				WINDOWS_RESERVED_CHARACTERS.test(segment) ||
				WINDOWS_RESERVED_SEGMENT.test(segment),
		)
	) {
		return INVALID;
	}
	return path;
}
