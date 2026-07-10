import { LibraryV3ValidationError, MAX_LIBRARY_V3_BYTES, type LibraryV3 } from "./model";
import { utf8ByteLength } from "./scalars";
import { validateLibraryV3 } from "./validateLibrary";

export function decodeLibraryV3(serialized: string): LibraryV3 | null {
	if (
		typeof serialized !== "string" ||
		serialized.length === 0 ||
		serialized.length > MAX_LIBRARY_V3_BYTES ||
		utf8ByteLength(serialized) > MAX_LIBRARY_V3_BYTES
	) {
		return null;
	}
	try {
		return validateLibraryV3(JSON.parse(serialized));
	} catch {
		return null;
	}
}

export function encodeLibraryV3(value: unknown): string {
	const normalized = validateLibraryV3(value);
	if (!normalized) throw new LibraryV3ValidationError();
	return JSON.stringify(normalized);
}
