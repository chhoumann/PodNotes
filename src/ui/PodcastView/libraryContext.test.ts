import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

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
]);
// Legacy components the shell hosts unchanged, which read the stores themselves.
const LEGACY = new Set(["EpisodeList.svelte"]);

test("the view's components read the library from their services, not from src/store", () => {
	const dir = import.meta.dirname;
	const reads = readdirSync(dir)
		.filter((file) => file.endsWith(".svelte") && !LEGACY.has(file))
		.flatMap((file) =>
			[
				...readFileSync(`${dir}/${file}`, "utf8").matchAll(
					/import\s*\{([^}]*)\}\s*from\s*"(?:src\/|(?:\.\.\/)+)store(?:\/index)?"/g,
				),
			]
				.flatMap(([, names]) => names.split(",").map((name) => name.trim().split(/\s+/)[0]))
				.filter((name) => LIBRARY_STORES.has(name))
				.map((name) => `${file} imports ${name}`),
		);

	expect(reads).toEqual([]);
});
