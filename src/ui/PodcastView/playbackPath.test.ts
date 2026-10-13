import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// openEpisode refuses an episode offline before it calls the player, so it is the one caller.
const ALLOWED = new Set(["menus.ts"]);

const PLAY_CALL = /\.\s*play\s*\(/g;

/** Every call of `play` in `source`, named for the file it is in. */
function playCalls(file: string, source: string): string[] {
	return [...source.matchAll(PLAY_CALL)].map(() => `${file} calls play`);
}

test("only openEpisode starts an episode from the view", () => {
	const dir = import.meta.dirname;
	const calls = readdirSync(dir)
		.filter(
			(file) =>
				/\.(svelte|ts)$/.test(file) && !file.endsWith(".test.ts") && !ALLOWED.has(file),
		)
		.flatMap((file) => playCalls(file, readFileSync(`${dir}/${file}`, "utf8")));

	expect(calls).toEqual([]);
});

describe("the guard reports", () => {
	test.each([
		"player.play(episode);",
		"services.player.play(episode)",
		"onclick={() => player?.play(queued)}",
		"plugin.player\n\t.play(episode)",
	])("%s", (source) => {
		expect(playCalls("Page.svelte", source)).toEqual(["Page.svelte calls play"]);
	});

	test("nothing for the player's other controls or a row's onplay", () => {
		const source = "player.toggle();\nonplay={() => openEpisode(services, episode)}";
		expect(playCalls("Page.svelte", source)).toEqual([]);
	});
});
