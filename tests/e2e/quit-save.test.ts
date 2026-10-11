import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { createPodNotesE2EHarness, evalJsonAsync, PLUGIN_ID, type PodNotesData } from "./harness";

const getContext = createPodNotesE2EHarness("quit-save");

// Saves wait about a second for more changes. Quitting inside that second must
// still write the change, completely, before the window goes away. Obsidian's
// quit hook triggers "quit" with a task list, awaits every task, then closes the
// window; this drives the same sequence without closing the test's window.
test("saves a change made just before Obsidian quits, as a complete data.json", async () => {
	const { obsidian, plugin } = getContext();
	const dataPath = await plugin.dataPath();
	await plugin.data<PodNotesData>().patch((data) => {
		data.defaultVolume = 1;
	});
	await plugin.reload({ waitUntilReady: true });

	const quit = await evalJsonAsync<{ tasks: number; savedBeforeQuitSettled: boolean }>(
		obsidian,
		`(async () => {
			const podnotes = app.plugins.plugins.${PLUGIN_ID};
			podnotes.api.volume = 0.29;
			const promises = [];
			const tasks = {
				addPromise: (promise) => promises.push(promise),
				isEmpty: () => promises.length === 0,
				promise: () => Promise.all(promises),
			};
			app.workspace.trigger("quit", tasks);
			await tasks.promise();
			const file = app.vault.adapter.getFullPath(podnotes.manifest.dir + "/data.json");
			const onDisk = JSON.parse(require("fs").readFileSync(file, "utf8"));
			return { tasks: promises.length, savedBeforeQuitSettled: onDisk.defaultVolume === 0.29 };
		})()`,
	);

	// Obsidian adds tasks of its own when it has pending saves.
	expect(quit.tasks).toBeGreaterThanOrEqual(1);
	expect(quit.savedBeforeQuitSettled).toBe(true);
	const data = JSON.parse(await readFile(dataPath, "utf8")) as PodNotesData;
	expect(data.defaultVolume).toBe(0.29);
	// Writes after quit are refused; reloading the plugin gives the next test a live writer.
	await plugin.reload({ waitUntilReady: true });
});
