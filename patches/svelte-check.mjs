// svelte-check 4.7.6 exits 0 when its check throws, for example when the native
// TypeScript compiler cannot start. This applies the outer-catch half of the fix in
// https://github.com/sveltejs/language-tools/pull/3133.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const version = "4.7.6";
const published = "dc660e28bc246946ef1ce71a4e4d36483082edaf916470938889ab0518d18a79";
const patched = "65a915dd1d0a85d7770b40b90eb0178fe41f7ce826abdaedfc04b2cd3f91c96f";

const packageJson = createRequire(join(process.cwd(), "package.json")).resolve(
	"svelte-check/package.json",
);
const installed = JSON.parse(readFileSync(packageJson, "utf8")).version;
if (installed !== version) {
	throw new Error(
		`patches/svelte-check.mjs patches svelte-check ${version}, but ${installed} is installed. ` +
			`If ${installed} includes sveltejs/language-tools#3133, delete the script, its calls and lint/format paths in package.json, and its Dependabot ignore. ` +
			`Otherwise update the script for ${installed}.`,
	);
}

const entry = join(dirname(packageJson), "dist/src/index.js");
const source = readFileSync(entry, "utf8");
const hash = createHash("sha256").update(source).digest("hex");
if (hash === published) {
	writeFileSync(
		entry,
		source.replace(
			"console.error('svelte-check failed');\n",
			"console.error('svelte-check failed');\n" +
				"        // A failed run must not look like a clean one to CI.\n" +
				"        exitAfterFlush(1);\n",
		),
	);
} else if (hash !== patched) {
	throw new Error(
		`${entry} is neither svelte-check ${version} as published nor as patched. Reinstall dependencies with npm ci.`,
	);
}
