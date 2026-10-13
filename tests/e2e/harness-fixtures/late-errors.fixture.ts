import { afterAll, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "../harness";
import { jsLiteral } from "../runtime";

const getContext = createPodNotesE2EHarness("harness-late-errors");
const raise = (message: string) =>
	`window.dispatchEvent(new ErrorEvent("error", { message: ${jsLiteral(message)} })), true`;

afterAll(() => getContext().obsidian.dev.evalJson(raise("HARNESS_SUITE_CLEANUP_SENTINEL")));

test("an error raised after the test body still fails the test", async () => {
	const { obsidian, plugin } = getContext();
	const changed = await plugin.data<PodNotesData>().patch((data) => {
		data.skipBackwardLength = (data.skipBackwardLength ?? 0) + 1;
	});
	await obsidian.waitFor(
		() =>
			obsidian.dev.evalJson<boolean>(
				`app.plugins.plugins.podnotes.settings.skipBackwardLength === ${jsLiteral(changed.skipBackwardLength)}`,
			),
		{ message: "the fixture setting change to reach PodNotes" },
	);
	onTestFinished(() => obsidian.dev.evalJson(raise("HARNESS_TEST_CLEANUP_SENTINEL")));
	expect(await obsidian.dev.evalJson<boolean>("Boolean(app.plugins.plugins.podnotes.api)")).toBe(
		true,
	);
});
