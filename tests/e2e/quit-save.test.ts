import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { createPodNotesE2EHarness, PLUGIN_ID, type PodNotesData } from "./harness";
import { restartObsidian } from "./journey/actions";

const getContext = createPodNotesE2EHarness("quit-save");
const isolatedInstance = Boolean(process.env.OBSIDIAN_E2E_OBSIDIAN_HOME);

// A setting saves as soon as it changes. Quitting starts no save (#370), so that is
// what keeps a change made right before the window closes.
test.runIf(isolatedInstance)(
	"keeps a setting changed 50 ms before the main window closes",
	async () => {
		const { obsidian, plugin } = getContext();
		const dataPath = await plugin.dataPath();
		await plugin.data<PodNotesData>().patch((data) => {
			data.defaultVolume = 1;
		});
		await plugin.reload({ waitUntilReady: true });

		let onDisk: PodNotesData | undefined;
		await restartObsidian(
			obsidian,
			async () => {
				// Read by this process while Obsidian is gone.
				onDisk = JSON.parse(await readFile(dataPath, "utf8")) as PodNotesData;
			},
			`app.plugins.plugins.${PLUGIN_ID}.api.volume = 0.392`,
		);

		expect(onDisk?.defaultVolume).toBe(0.392);
	},
);
