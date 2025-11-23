import { describe, expect, it } from "vitest";
import { encodeUrlForRequest } from "./encodeUrlForRequest";

describe("encodeUrlForRequest", () => {
	it("encodes parentheses and whitespace while leaving structure intact", () => {
		const raw =
			"https://example.com/podcast/Episode (Part 1).mp3?token=(abc123)";
		expect(encodeUrlForRequest(raw)).toBe(
			"https://example.com/podcast/Episode%20%28Part%201%29.mp3?token=%28abc123%29",
		);
	});

	it("returns already encoded urls untouched", () => {
		const alreadyEncoded =
			"https://example.com/audio/Episode%20%28Part%201%29.mp3";
		expect(encodeUrlForRequest(alreadyEncoded)).toBe(alreadyEncoded);
	});

	it("handles empty strings safely", () => {
		expect(encodeUrlForRequest("")).toBe("");
		expect(encodeUrlForRequest("   ")).toBe("");
	});
});
