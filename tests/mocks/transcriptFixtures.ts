import { readFileSync } from "node:fs";
import path from "node:path";

export function transcriptFixture(name: string): string {
	return readFileSync(path.resolve("tests/fixtures/transcripts", name), "utf8");
}
