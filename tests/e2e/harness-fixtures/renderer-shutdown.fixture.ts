import fs from "node:fs/promises";
import path from "node:path";
import { expect, test } from "vitest";
import { createPodNotesE2EHarness } from "../harness";
import { reloadObsidian, restartObsidian } from "../journey/actions";
import { jsLiteral } from "../runtime";

const getContext = createPodNotesE2EHarness("harness-renderer-shutdown");
const throwOnUnload = (message: string) =>
	`window.addEventListener("unload", () => { throw new Error(${jsLiteral(message)}); })`;

test("an error thrown while the renderer unloads for a reload", async () => {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(`${throwOnUnload("HARNESS_RELOAD_UNLOAD_SENTINEL")}, true`);
	await reloadObsidian(obsidian);
});

test("an error journal write that fails while Obsidian quits", async () => {
	const { obsidian } = getContext();
	const journal = path.join(
		await obsidian.vaultPath(),
		".obsidian",
		"plugins",
		`podnotes-e2e-errors-${process.pid}`,
		"errors.jsonl",
	);
	await fs.chmod(journal, 0o444);
	try {
		await restartObsidian(
			obsidian,
			undefined,
			throwOnUnload("HARNESS_RESTART_UNLOAD_SENTINEL"),
		);
	} finally {
		await fs.chmod(journal, 0o644);
	}
});

test("the next test", async () => {
	expect(await getContext().obsidian.dev.evalJson<boolean>("app.workspace.layoutReady")).toBe(
		true,
	);
});
