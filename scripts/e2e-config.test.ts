import { DEFAULT_SETTINGS } from "src/constants";
import { describe, expect, it } from "vitest";
import config from "../obsidian-e2e.config.mjs";

describe("obsidian-e2e.config.mjs", () => {
	it("seeds a defaultData that mirrors the real DEFAULT_SETTINGS", () => {
		// JSON cannot represent currentEpisode: undefined, so compare the serialized
		// forms - this is exactly what lands in a freshly provisioned vault's
		// data.json. It fails if a setting is added to src/constants.ts without
		// updating the runner config's defaultData seed. The `schemaVersion: 2`
		// persistence marker PodNotes writes alongside its settings is seeded too, so
		// a provisioned vault opens on the current on-disk schema.
		expect(JSON.parse(JSON.stringify(config.defaultData))).toEqual({
			schemaVersion: 2,
			...JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
		});
	});
});
