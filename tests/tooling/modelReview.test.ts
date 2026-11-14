import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { curatedModels, renderReport, review } from "../../scripts/model-review.mjs";

const root = process.cwd();
const script = join(root, "scripts/model-review.mjs");
const catalog = JSON.parse(
	readFileSync(join(root, "tests/fixtures/transcription/openrouter-catalog.json"), "utf8"),
).data;
const curated = [
	{ provider: "openrouter", id: "x-ai/grok-stt-2.0" },
	{ provider: "openrouter", id: "elevenlabs/scribe-v2" },
	{ provider: "openrouter", id: "microsoft/mai-transcribe-2" },
	{ provider: "deepgram", id: "nova-3" },
	{ provider: "elevenlabs", id: "scribe_v3" },
	{ provider: "openai", id: "gpt-transcribe" },
];
const result = review({ curated, catalog, today: "2026-11-14" });

describe("model review", () => {
	it("reports a curated model past its end date", () => {
		expect(result.ending).toEqual([
			{ id: "x-ai/grok-stt-2.0", ends: "2026-11-01", past: true },
		]);
		expect(
			renderReport(result, { catalogSize: catalog.length, today: "2026-11-14" }),
		).toContain("`x-ai/grok-stt-2.0` ended 2026-11-01.");
	});

	it("reports a curated model the catalog no longer lists", () => {
		expect(result.gone).toEqual(["microsoft/mai-transcribe-2"]);
	});

	it("reports a model newer than a curated model of its family", () => {
		expect(result.newer.map(({ model, than }) => [model.id, than])).toEqual([
			["deepgram/nova-4", "nova-3"],
		]);
	});

	it("lists a model of no curated family once as a candidate", () => {
		expect(result.candidates.map(({ id }) => id)).toEqual([
			"elevenlabs/scribe-v2-medical",
			"google/chirp-3",
		]);
	});
});

describe("model review CLI", () => {
	const directory = mkdtempSync(join(tmpdir(), "podnotes-model-review-"));
	afterAll(() => rmSync(directory, { recursive: true, force: true }));

	function run(models: { id: string }[]) {
		const file = join(directory, "catalog.json");
		writeFileSync(file, JSON.stringify({ data: models }));
		return spawnSync(process.execPath, [script, "--catalog", file], { encoding: "utf8" });
	}

	it("passes when the catalog lists every curated OpenRouter model", () => {
		const listed = curatedModels()
			.filter(({ provider }) => provider === "openrouter")
			.map(({ id }) => ({ id }));
		expect(listed.length).toBeGreaterThan(0);
		expect(run(listed).status).toBe(0);
	});

	it("fails when the catalog lists none of them", () => {
		const result = run([]);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("is not in the catalog.");
	});
});
