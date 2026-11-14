// Reports whether the transcription models PodNotes curates are still current. The curated
// IDs are read from the provider files, and the models OpenRouter's public catalog lists
// are compared with them. Exits 1 when a curated OpenRouter model is gone or past its end date.
//
//   npm run review:models [-- --catalog <saved catalog.json>]
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROVIDERS = fileURLToPath(
	new URL("../src/services/transcription/providers/", import.meta.url),
);
const CATALOG_URL = "https://openrouter.ai/api/v1/models?output_modalities=transcription";

/**
 * @typedef {{ provider: string, id: string }} Curated
 * @typedef {{ id: string, name?: string, created?: number, expiration_date?: string | null }} CatalogModel
 */

/**
 * Every model ID in the provider files, with the provider whose file lists it.
 * @param {string} [directory]
 * @returns {Curated[]}
 */
export function curatedModels(directory = PROVIDERS) {
	return readdirSync(directory)
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
		.sort()
		.flatMap((file) => {
			const source = readFileSync(new URL(file, pathToFileURL(`${directory}/`)), "utf8");
			return [...source.matchAll(/^\s+id: "([^"]+)",$/gm)].map(([, id]) => ({
				provider: file.slice(0, -".ts".length),
				id,
			}));
		});
}

/**
 * A model's family is its vendor and the words of its name that are not a version, so
 * `elevenlabs/scribe-v2` and the direct `scribe_v3` belong to one family.
 * @param {string} provider the vendor of an ID that names none
 * @param {string} id
 */
function parse(provider, id) {
	const slash = id.indexOf("/");
	const vendor = slash < 0 ? provider : id.slice(0, slash);
	const words = id
		.slice(slash + 1)
		.toLowerCase()
		.split(/[-_]/);
	const isVersion = (/** @type {string} */ word) => /^v?\d+(\.\d+)*$/.test(word);
	return {
		family: [vendor, ...words.filter((word) => !isVersion(word))].join("-"),
		version: words
			.filter(isVersion)
			.flatMap((word) => word.replace(/^v/, "").split(".").map(Number)),
	};
}

/**
 * @param {number[]} a
 * @param {number[]} b
 */
function compare(a, b) {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const difference = (a[i] ?? 0) - (b[i] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

/**
 * @param {{ curated: Curated[], catalog: CatalogModel[], today: string }} input
 * @returns {{
 *   gone: string[],
 *   ending: { id: string, ends: string, past: boolean }[],
 *   newer: { model: CatalogModel, than: string }[],
 *   candidates: CatalogModel[],
 * }}
 */
export function review({ curated, catalog, today }) {
	const listed = new Map(catalog.map((model) => [model.id, model]));
	const gone = [];
	const ending = [];
	for (const { provider, id } of curated) {
		if (provider !== "openrouter") continue;
		const model = listed.get(id);
		if (!model) gone.push(id);
		else if (model.expiration_date) {
			const ends = model.expiration_date.slice(0, 10);
			ending.push({ id, ends, past: ends <= today });
		}
	}

	/** @type {Map<string, { provider: string, id: string, version: number[] }[]>} */
	const families = new Map();
	for (const { provider, id } of curated) {
		const { family, version } = parse(provider, id);
		families.set(family, [...(families.get(family) ?? []), { provider, id, version }]);
	}

	/**
	 * The newest curated model a catalog model is measured against: the OpenRouter one when
	 * the family has any, since a direct provider's version says nothing about it.
	 * @param {{ provider: string, id: string, version: number[] }[]} own
	 */
	const latest = (own) => {
		const viaOpenRouter = own.filter(({ provider }) => provider === "openrouter");
		return (viaOpenRouter.length > 0 ? viaOpenRouter : own).reduce((a, b) =>
			compare(b.version, a.version) > 0 ? b : a,
		);
	};

	const newer = [];
	const candidates = [];
	const fresh = catalog
		.filter((model) => !model.expiration_date)
		.sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
	for (const model of fresh) {
		const { family, version } = parse("", model.id);
		const own = families.get(family);
		if (!own) candidates.push(model);
		else if (compare(version, latest(own).version) > 0) {
			newer.push({ model, than: latest(own).id });
		} else if (!own.some((curatedModel) => compare(version, curatedModel.version) === 0)) {
			candidates.push(model);
		}
	}
	return { gone, ending, newer, candidates };
}

/**
 * @param {ReturnType<typeof review>} result
 * @param {{ catalogSize: number, today: string }} context
 */
export function renderReport({ gone, ending, newer, candidates }, { catalogSize, today }) {
	/** @type {string[]} */
	const lines = [
		"# Transcription model review",
		"",
		`Checked ${today} against the OpenRouter catalog (${catalogSize} models).`,
	];
	/**
	 * @param {string} heading
	 * @param {string[]} items
	 */
	const section = (heading, items) => {
		if (items.length > 0) lines.push("", `## ${heading}`, "", ...items.map((i) => `- ${i}`));
	};
	section("Curated models gone or ending", [
		...gone.map((id) => `\`${id}\` is not in the catalog.`),
		...ending.map(({ id, ends, past }) => `\`${id}\` ${past ? "ended" : "ends"} ${ends}.`),
	]);
	section(
		"Newer models in a curated family",
		newer.map(({ model, than }) => `\`${model.id}\` is newer than \`${than}\`.`),
	);
	section(
		"Candidates, not curated",
		candidates.map(({ id, name }) => `\`${id}\`${name ? ` (${name})` : ""}`),
	);
	if (gone.length + ending.length + newer.length + candidates.length === 0) {
		lines.push("", "Nothing to review.");
	}
	return `${lines.join("\n")}\n`;
}

/** @param {string[]} args */
async function main(args) {
	const file = args[args.indexOf("--catalog") + 1];
	const body =
		args.includes("--catalog") && file
			? JSON.parse(readFileSync(file, "utf8"))
			: await fetch(CATALOG_URL, { signal: AbortSignal.timeout(30_000) }).then((response) => {
					if (!response.ok) throw new Error(`The catalog answered ${response.status}.`);
					return response.json();
				});
	/** @type {CatalogModel[]} */
	const catalog = body.data;
	const today = new Date().toISOString().slice(0, 10);
	const result = review({ curated: curatedModels(), catalog, today });
	process.stdout.write(renderReport(result, { catalogSize: catalog.length, today }));
	if (result.gone.length > 0 || result.ending.some(({ past }) => past)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main(process.argv.slice(2)).catch((error) => {
		console.error(`Model review failed: ${error instanceof Error ? error.message : error}`);
		process.exitCode = 1;
	});
}
