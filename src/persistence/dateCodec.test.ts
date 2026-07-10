import { describe, expect, it } from "vitest";
import { dateTimestamp, decodeDate, encodeDate } from "./dateCodec";

describe("dateCodec", () => {
	const iso = "2024-03-01T10:05:03.000Z";

	it("decodes Date instances and ISO text to cloned valid dates", () => {
		const source = new Date(iso);
		const fromDate = decodeDate(source);
		const fromText = decodeDate(iso);

		expect(fromDate).toEqual(source);
		expect(fromDate).not.toBe(source);
		expect(fromText).toEqual(source);
	});

	it("encodes valid inputs as canonical ISO-8601 text", () => {
		expect(encodeDate(new Date(iso))).toBe(iso);
		expect(encodeDate("2024-03-01T11:05:03+01:00")).toBe(iso);
	});

	it.each([undefined, null, "", "   ", "not-a-date", 1_709_290_000_000, {}, []])(
		"rejects invalid or unsupported input %p without throwing",
		(value) => {
			expect(decodeDate(value)).toBeUndefined();
			expect(encodeDate(value)).toBeUndefined();
			expect(dateTimestamp(value)).toBeUndefined();
		},
	);

	it("returns a timestamp only for valid inputs", () => {
		expect(dateTimestamp(iso)).toBe(new Date(iso).getTime());
	});
});
