import { expect, test } from "vitest";
import { createPodNotesE2EHarness, type PodNotesData } from "./harness";
import { openPodNotesSettings, reloadObsidian, restartObsidian } from "./journey/actions";
import { typeInto } from "./journey/input";
import { ui } from "./journey/targets";
import { jsLiteral, RELOAD_OPTIONS } from "./runtime";

const getContext = createPodNotesE2EHarness("focused-settings-save");

test.runIf(Boolean(process.env.OBSIDIAN_E2E_OBSIDIAN_HOME)).each(["quit", "reload"])(
	"keeps a focused text edit after its debounce through app %s",
	async (action) => {
		const { obsidian, plugin } = getContext();
		await plugin.updateDataAndReload<PodNotesData>((data) => {
			data.note = { path: "Initial/{{title}}.md", template: "# {{title}}" };
		}, RELOAD_OPTIONS);
		await openPodNotesSettings(obsidian);
		const path = `Focused/${action}/{{title}}.md`;
		await typeInto(obsidian, ui.settingControl("Episode note path", "input"), path, {
			replace: true,
		});
		await obsidian.sleep(750);
		expect(
			await obsidian.dev.evalJson<boolean>(
				`document.activeElement?.value === ${jsLiteral(path)}`,
			),
			"the field remains focused without blur or completion",
		).toBe(true);

		if (action === "quit") await restartObsidian(obsidian);
		else await reloadObsidian(obsidian);

		expect((await plugin.data<PodNotesData>().read()).note?.path).toBe(path);
		expect(
			await obsidian.dev.evalJson<string>("app.plugins.plugins.podnotes.settings.note.path"),
			"the restarted plugin loads the focused edit",
		).toBe(path);
	},
);
