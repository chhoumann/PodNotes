// Keeps every heading fragment of the retired MkDocs site working, so old
// section links such as /commands/#show-player still land on their section.
//
//   node scripts/legacy-fragments.mjs check [dist]
//     Fails if a page in dist lacks an id listed in legacy-fragments.json.
//     Runs after every `npm run build`.
//   node scripts/legacy-fragments.mjs extract <mkdocs-site-dir>
//     Rewrites legacy-fragments.json from a MkDocs build. It was generated from
//     master at f7b9874 (the last MkDocs commit) with:
//       git archive f7b9874 docs | tar -x -C <dir>
//       uvx --from mkdocs==1.6.1 --with mkdocs-material==9.7.7 \
//         mkdocs build -f <dir>/docs/mkdocs.yml -d site
import { globSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const fixture = new URL("../legacy-fragments.json", import.meta.url);
const [mode, dir = mode === "check" ? "dist" : undefined] = process.argv.slice(2);

const pagePath = (file) => `/${file.replace(/index\.html$/, "")}`;
const idsIn = (html, pattern) => [...html.matchAll(pattern)].map((match) => match[1]);

if (mode === "extract" && dir) {
	const pages = {};
	for (const file of globSync("**/index.html", { cwd: dir }).sort()) {
		const ids = idsIn(readFileSync(join(dir, file), "utf8"), /<h[1-6][^>]*\sid="([^"]+)"/g);
		if (ids.length > 0) pages[pagePath(file)] = ids;
	}
	writeFileSync(fixture, `${JSON.stringify(pages, null, "\t")}\n`);
	console.log(`Wrote ${Object.keys(pages).length} pages to legacy-fragments.json`);
} else if (mode === "check" && dir) {
	const pages = JSON.parse(readFileSync(fixture, "utf8"));
	const missing = [];
	for (const [path, ids] of Object.entries(pages)) {
		const html = readFileSync(join(dir, path, "index.html"), "utf8");
		const present = new Set(idsIn(html, /\sid="([^"]+)"/g));
		for (const id of ids) if (!present.has(id)) missing.push(`${path}#${id}`);
	}
	if (missing.length > 0) {
		console.error(`Old MkDocs fragments with no target:\n${missing.join("\n")}`);
		process.exit(1);
	}
	const count = Object.values(pages).flat().length;
	console.log(`All ${count} legacy fragments resolve.`);
} else {
	console.error("Usage: legacy-fragments.mjs check [dist] | extract <mkdocs-site-dir>");
	process.exit(2);
}
