import { expect, test } from "vitest";
import { createPodNotesE2EHarness } from "../harness";

const getContext = createPodNotesE2EHarness("harness-reused-vault");

test("opens the collapsed left sidebar, is online and loads only its own recorder, before PodNotes", async () => {
	const { obsidian } = getContext();
	expect(await obsidian.dev.evalJson<boolean>("navigator.onLine"), "online").toBe(true);
	const left = await obsidian.dev.evalJson<{
		collapsed: boolean;
		size: number;
		width: number;
	}>(`({
		collapsed: app.workspace.leftSplit.collapsed,
		size: app.workspace.leftSplit.size,
		width: app.workspace.leftSplit.containerEl.getBoundingClientRect().width,
	})`);
	expect(left).toMatchObject({ collapsed: false, size: 280 });
	expect(left.width).toBeGreaterThanOrEqual(200);
	const recorder = `podnotes-e2e-errors-${process.pid}`;
	const enabled = await obsidian.dev.evalJson<string[]>("[...app.plugins.enabledPlugins]");
	expect(enabled.filter((id) => id.startsWith("podnotes-e2e-errors-"))).toEqual([recorder]);
	expect(enabled.indexOf(recorder)).toBeLessThan(enabled.indexOf("podnotes"));
	expect(
		await obsidian.dev.evalJson<string[]>(
			'Object.keys(app.plugins.plugins).filter((id) => id.startsWith("podnotes-e2e-errors-"))',
		),
	).toEqual([recorder]);
});
