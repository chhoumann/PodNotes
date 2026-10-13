import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const PLAY_CALL = /\.\s*play\s*\(/g;
const TOP_LEVEL = /^(?:export )?(?:async )?function (\w+)|^\}/gm;

function playCalls(file: string, source: string): string[] {
	return [...source.matchAll(PLAY_CALL)].map(({ index }) => {
		let inside: string | undefined;
		for (const [, name] of source.slice(0, index).matchAll(TOP_LEVEL)) inside = name;
		return inside ? `${file} calls play in ${inside}` : `${file} calls play`;
	});
}

test("only openEpisode starts an episode from the view", () => {
	const dir = import.meta.dirname;
	const calls = readdirSync(dir)
		.filter((file) => /\.(svelte|ts)$/.test(file) && !file.endsWith(".test.ts"))
		.flatMap((file) => playCalls(file, readFileSync(`${dir}/${file}`, "utf8")));

	expect(calls).toEqual(["menus.ts calls play in openEpisode"]);
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

	test("the top-level function each call is in, and none past its end", () => {
		const source = [
			"export function openEpisode(services, episode) {",
			"\tplayer.play(episode);",
			"}",
			"function playNext(services) {",
			"\tservices.player.play(next);",
			"}",
			"const later = () => player.play(episode);",
		].join("\n");

		expect(playCalls("menus.ts", source)).toEqual([
			"menus.ts calls play in openEpisode",
			"menus.ts calls play in playNext",
			"menus.ts calls play",
		]);
	});

	test("nothing for the player's other controls or a row's onplay", () => {
		const source = "player.toggle();\nonplay={() => openEpisode(services, episode)}";
		expect(playCalls("Page.svelte", source)).toEqual([]);
	});
});
