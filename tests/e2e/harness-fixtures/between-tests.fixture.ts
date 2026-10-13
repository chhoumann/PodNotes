import { aroundEach, expect, test } from "vitest";
import { createPodNotesE2EHarness } from "../harness";
import { jsLiteral } from "../runtime";

let finished = 0;
// Registered before the harness, so it wraps the harness and raises the error
// after the first test's last runtime check.
aroundEach(async (runTest) => {
	await runTest();
	if (++finished === 1)
		await getContext().obsidian.dev.evalJson(
			`window.dispatchEvent(new ErrorEvent("error", { message: ${jsLiteral("HARNESS_BETWEEN_TESTS_SENTINEL")} })), true`,
		);
});
const getContext = createPodNotesE2EHarness("harness-between-tests");

for (const name of ["first", "second", "third"]) {
	test(name, async () => {
		expect(await getContext().obsidian.dev.evalJson<boolean>("app.workspace.layoutReady")).toBe(
			true,
		);
	});
}
