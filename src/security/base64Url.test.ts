import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url } from "./base64Url";

describe("base64url", () => {
	it.each([
		[[], ""],
		[[0], "AA"],
		[[0, 1], "AAE"],
		[[0, 1, 2], "AAEC"],
		[[251, 255, 239], "-__v"],
	] as const)("round-trips canonical unpadded bytes %#", (bytes, encoded) => {
		const value = Uint8Array.from(bytes);
		expect(encodeBase64Url(value)).toBe(encoded);
		expect(decodeBase64Url(encoded, value.length, value.length)).toEqual(value);
	});

	it.each(["A", "AA=", "AA==", "AA+", "AA/", "AA\n", " A", "A A", "å"])(
		"rejects noncanonical text %j",
		(value) => {
			expect(decodeBase64Url(value, 8)).toBeNull();
		},
	);

	it("checks encoded and decoded bounds before returning bytes", () => {
		expect(decodeBase64Url("AAE", 1)).toBeNull();
		expect(decodeBase64Url("AAE", 2, 1)).toBeNull();
		expect(decodeBase64Url("AAE", 2, 2)).toEqual(Uint8Array.from([0, 1]));
		expect(decodeBase64Url("A".repeat(10_000), 32)).toBeNull();
	});

	it("handles values large enough to require chunked browser encoding", () => {
		const value = new Uint8Array(150_000);
		for (let index = 0; index < value.length; index += 1) value[index] = index % 251;
		const encoded = encodeBase64Url(value);
		expect(decodeBase64Url(encoded, value.length, value.length)).toEqual(value);
	});
});
