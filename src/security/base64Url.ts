const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/;

function maximumEncodedCharacters(maximumBytes: number): number {
	return Math.ceil((maximumBytes * 4) / 3);
}

export function encodeBase64Url(value: Uint8Array): string {
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < value.length; offset += chunkSize) {
		binary += String.fromCharCode(...value.subarray(offset, offset + chunkSize));
	}
	return btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** Decode only canonical, unpadded base64url within an allocation bound. */
export function decodeBase64Url(
	value: unknown,
	maximumBytes: number,
	exactBytes?: number,
): Uint8Array<ArrayBuffer> | null {
	if (
		typeof value !== "string" ||
		!Number.isSafeInteger(maximumBytes) ||
		maximumBytes < 0 ||
		value.length > maximumEncodedCharacters(maximumBytes) ||
		value.length % 4 === 1 ||
		!BASE64URL_PATTERN.test(value)
	) {
		return null;
	}

	try {
		const padding = "=".repeat((4 - (value.length % 4)) % 4);
		const binary = atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + padding);
		if (
			binary.length > maximumBytes ||
			(exactBytes !== undefined && binary.length !== exactBytes)
		) {
			return null;
		}
		const decoded = new Uint8Array(binary.length);
		for (let index = 0; index < binary.length; index += 1) {
			decoded[index] = binary.charCodeAt(index);
		}
		return encodeBase64Url(decoded) === value ? decoded : null;
	} catch {
		return null;
	}
}
