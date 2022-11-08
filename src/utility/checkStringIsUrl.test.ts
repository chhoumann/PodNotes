import { expect, test, describe } from "vitest";
import checkStringIsUrl from "./checkStringIsUrl";

describe("checkStringIsUrl", () => {
    test("returns null if the string is not a valid URL", () => {
        expect(checkStringIsUrl("not a url")).toBeNull();
    });

    test("returns a URL object if the string is a valid URL", () => {
        expect(checkStringIsUrl("https://example.com")).toBeInstanceOf(URL);
    });

    test("returns null on empty string", () => {
        expect(checkStringIsUrl("")).toBeNull();
    });
});