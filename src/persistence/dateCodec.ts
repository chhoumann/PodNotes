/**
 * Decode a date crossing a JSON or external-data boundary.
 *
 * Runtime PodNotes objects use real `Date` instances. Persisted dates use ISO
 * strings. Keeping the conversion here prevents the two representations from
 * leaking into the rest of the application.
 */
export function decodeDate(value: unknown): Date | undefined {
	let decoded: Date;

	if (value instanceof Date) {
		decoded = new Date(value.getTime());
	} else if (typeof value === "string" && value.trim() !== "") {
		decoded = new Date(value);
	} else {
		return undefined;
	}

	return Number.isFinite(decoded.getTime()) ? decoded : undefined;
}

/** Encode a runtime date as canonical ISO-8601 text without ever throwing. */
export function encodeDate(value: unknown): string | undefined {
	return decodeDate(value)?.toISOString();
}

/** Return a comparable epoch timestamp for a valid date-like value. */
export function dateTimestamp(value: unknown): number | undefined {
	if (value instanceof Date) {
		const timestamp = value.getTime();
		return Number.isFinite(timestamp) ? timestamp : undefined;
	}
	return decodeDate(value)?.getTime();
}
