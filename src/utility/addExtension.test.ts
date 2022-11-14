import { expect, describe, test } from "vitest";
import addExtension from "./addExtension";

describe("addExtension", () => {
    test("adds an extension to a file path", () => {
        expect(addExtension("path/to/file", "md")).toBe("path/to/file.md");
    });
        
    test("does not add an extension if the file path already has one", () => {
        expect(addExtension("path/to/file.md", "md")).toBe("path/to/file.md");
    });

    test("works with and without dot in extension", () => {
        expect(addExtension("path/to/file", ".md")).toBe("path/to/file.md");
        expect(addExtension("path/to/file.md", "md")).toBe("path/to/file.md");
    });
});