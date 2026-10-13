import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// MainView fills `ShellServices.library` from these stores, and the view's components read them there.
const LIBRARY_STORES = new Set([
	"savedFeeds",
	"queue",
	"favorites",
	"playlists",
	"localFiles",
	"playedEpisodes",
	"downloadedEpisodes",
	"episodeListLimit",
	"hidePlayedEpisodes",
]);
// MainView, which fills `ShellServices.library` from them.
const ALLOWED = new Set(["index.ts"]);

const STORE_MODULE = String.raw`"(?:src\/|(?:\.\.\/)+)store(?:\/[^"]*)?"`;
// `import { queue }`, `export { queue as q }`: named bindings of src/store or one of its modules.
const NAMED = new RegExp(
	String.raw`(import|export)\s*(?:type\s*)?\{([^}]*)\}\s*from\s*${STORE_MODULE}`,
	"g",
);
// `import * as store`, `export *`: every store at once.
const WHOLE = new RegExp(
	String.raw`(import|export)\s*\*\s*(?:as\s+\w+\s*)?from\s*${STORE_MODULE}`,
	"g",
);

/** Every way `source` reaches a library store in src/store, named for the file it is in. */
function libraryReads(file: string, source: string): string[] {
	const named = [...source.matchAll(NAMED)].flatMap(([, verb, names]) =>
		names
			.split(",")
			.map((name) => name.trim().split(/\s+/)[0])
			.filter((name) => LIBRARY_STORES.has(name))
			.map((name) => `${file} ${verb}s ${name}`),
	);
	const whole = [...source.matchAll(WHOLE)].map(([, verb]) => `${file} ${verb}s every store`);
	return [...named, ...whole];
}

test("the view's components read the library from their services, not from src/store", () => {
	const dir = import.meta.dirname;
	const reads = readdirSync(dir)
		.filter(
			(file) =>
				/\.(svelte|ts)$/.test(file) && !file.endsWith(".test.ts") && !ALLOWED.has(file),
		)
		.flatMap((file) => libraryReads(file, readFileSync(`${dir}/${file}`, "utf8")));

	expect(reads).toEqual([]);
});

describe("the guard reports", () => {
	test.each([
		['import { queue } from "src/store";', "Page.svelte imports queue"],
		[
			'import {\n\tfavorites,\n\ttype Playlist,\n} from "../../store/index";',
			"Page.svelte imports favorites",
		],
		['import { savedFeeds } from "src/store/feeds";', "Page.svelte imports savedFeeds"],
		['export { queue } from "src/store";', "Page.svelte exports queue"],
		[
			'export { downloadedEpisodes as downloads } from "../../store/downloads";',
			"Page.svelte exports downloadedEpisodes",
		],
		['export * from "src/store";', "Page.svelte exports every store"],
		['import * as store from "src/store";', "Page.svelte imports every store"],
	])("%s", (source, report) => {
		expect(libraryReads("Page.svelte", source)).toEqual([report]);
	});

	test("nothing for svelte/store or a type that is not a store", () => {
		const source =
			'import { get } from "svelte/store";\nimport type { QueueMove } from "src/store";';
		expect(libraryReads("Page.svelte", source)).toEqual([]);
	});
});
