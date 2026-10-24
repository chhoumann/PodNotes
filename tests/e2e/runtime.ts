import type { ObsidianClient, PluginReloadOptions } from "obsidian-e2e";

import { jsLiteral } from "../../scripts/js-literal.mjs";

export { jsLiteral };

export const PLUGIN_ID = "podnotes";
export const VIEW_TYPE = "podcast_player_view";
export const WAIT_OPTS = { timeoutMs: 15_000, intervalMs: 200 };
export const RELOAD_OPTIONS: PluginReloadOptions = {
	waitUntilReady: true,
	timeoutMs: 30_000,
	readyOptions: {
		// This command is registered unconditionally.
		commandId: `${PLUGIN_ID}:podnotes-show-leaf`,
		...WAIT_OPTS,
	},
};

export async function runAllSteps(...steps: Array<() => Promise<unknown>>): Promise<void> {
	const failures: unknown[] = [];
	for (const step of steps) {
		try {
			await step();
		} catch (error) {
			failures.push(error);
		}
	}
	if (failures.length === 1) throw failures[0];
	if (failures.length > 1) throw new AggregateError(failures, "Several harness steps failed.");
}

export async function waitForPodNotesReady(obsidian: ObsidianClient): Promise<void> {
	await obsidian.waitFor(() => podNotesReady(obsidian), {
		...WAIT_OPTS,
		message: "PodNotes plugin did not become ready.",
	});
}

export function podNotesReady(obsidian: ObsidianClient): Promise<boolean> {
	return obsidian.dev.evalJson<boolean>(`
		Boolean(
			app.plugins.plugins.${PLUGIN_ID}?.api &&
			(app.workspace.protocolHandlers ?? app.workspace.protocolHandler?.handlers)?.has(${jsLiteral(PLUGIN_ID)})
		)
	`);
}
