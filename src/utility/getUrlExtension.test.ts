import { describe, test, expect } from "vitest";
import getUrlExtension from "./getUrlExtension";

describe("getUrlExtension", () => {
	test("should return the extension of a url", () => {
		expect(getUrlExtension("https://example.com/file.mp3")).toBe("mp3");
	});

	test("should return the extension of a url with params", () => {
		expect(getUrlExtension("https://example.com/file.mp3?key=value&key2=.mpegvalue")).toBe("mp3");
	});
});
