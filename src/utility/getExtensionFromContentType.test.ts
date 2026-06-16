import { describe, expect, test } from "vitest";
import getExtensionFromContentType from "./getExtensionFromContentType";

describe("getExtensionFromContentType", () => {
	test("detects mp3 from standard mime type", () => {
		expect(getExtensionFromContentType("audio/mpeg")).toBe("mp3");
	});

	test("handles mixed case mime types", () => {
		expect(getExtensionFromContentType("Audio/X-M4A")).toBe("m4a");
	});

	test("detects video mime types", () => {
		expect(getExtensionFromContentType("video/mp4")).toBe("mp4");
		expect(getExtensionFromContentType("Video/WebM")).toBe("webm");
	});

	test("returns null when mime type is not playable media", () => {
		expect(getExtensionFromContentType("text/html")).toBeNull();
	});
});
