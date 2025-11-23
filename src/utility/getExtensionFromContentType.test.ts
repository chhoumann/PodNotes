import { describe, expect, test } from "vitest";
import getExtensionFromContentType from "./getExtensionFromContentType";

describe("getExtensionFromContentType", () => {
	test("detects mp3 from standard mime type", () => {
		expect(getExtensionFromContentType("audio/mpeg")).toBe("mp3");
	});

	test("handles mixed case mime types", () => {
		expect(getExtensionFromContentType("Audio/X-M4A")).toBe("m4a");
	});

	test("returns null when mime type is not audio", () => {
		expect(getExtensionFromContentType("text/html")).toBeNull();
	});
});
