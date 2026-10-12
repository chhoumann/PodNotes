import { readFileSync } from "node:fs";
import path from "node:path";

/** A file from tests/fixtures/transcripts, decoded as UTF-8 with its bytes otherwise unchanged. */
export function transcriptFixture(name: string): string {
	return readFileSync(path.resolve("tests/fixtures/transcripts", name), "utf8");
}
