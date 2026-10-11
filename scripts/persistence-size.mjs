import assert from "node:assert/strict";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLargeV2Fixture } from "../tests/fixtures/persistence/large-v2.mjs";

/** @param {unknown} data */
export function measureSnapshot(data) {
	assert(
		data && typeof data === "object" && !Array.isArray(data),
		"Expected a v2 document object",
	);
	const root = /** @type {Record<string, unknown>} */ (data);
	assert.equal(root.schemaVersion, 2, "Expected schemaVersion 2");
	const compact = Buffer.byteLength(JSON.stringify(root));
	const pretty = Buffer.byteLength(JSON.stringify(root, null, 2));
	const fields = Object.entries(root).map(([name, value]) => ({
		name,
		compact: Buffer.byteLength(`${JSON.stringify(name)}:${JSON.stringify(value)}`),
		pretty: Buffer.byteLength(JSON.stringify({ [name]: value }, null, 2).slice(2, -2)),
	}));
	const framing = {
		compact: 2 + Math.max(0, fields.length - 1),
		pretty: 4 + Math.max(0, fields.length - 1) * 2,
	};
	assert.equal(
		fields.reduce((sum, field) => sum + field.compact, framing.compact),
		compact,
	);
	assert.equal(
		fields.reduce((sum, field) => sum + field.pretty, framing.pretty),
		pretty,
	);
	/** @type {Map<string, number>} */
	const copies = new Map();
	const identities = new Set();
	let episodeCopies = 0;
	let episodeTextBytes = 0;
	/** @param {unknown} value */
	function visit(value) {
		if (!value || typeof value !== "object") return;
		const object = /** @type {Record<string, unknown>} */ (value);
		if (
			!Array.isArray(value) &&
			typeof object.streamUrl === "string" &&
			typeof object.podcastName === "string" &&
			typeof object.title === "string"
		) {
			episodeCopies++;
			identities.add(JSON.stringify([object.podcastName, object.title]));
			const serialized = JSON.stringify(value);
			copies.set(serialized, (copies.get(serialized) ?? 0) + 1);
			for (const key of ["description", "content"]) {
				if (typeof object[key] === "string")
					episodeTextBytes += Buffer.byteLength(JSON.stringify(object[key]));
			}
		}
		for (const child of Object.values(value)) visit(child);
	}
	visit(root);
	const repeatedSnapshotBytes = [...copies].reduce(
		(sum, [snapshot, count]) => sum + Buffer.byteLength(snapshot) * (count - 1),
		0,
	);
	return {
		compact,
		pretty,
		fields,
		framing,
		episodeCopies,
		distinctEpisodes: identities.size,
		repeatedSnapshotBytes,
		episodeTextBytes,
	};
}

/** @param {unknown} base @param {unknown} candidate @param {string} [path] */
export function assertAdditive(base, candidate, path = "data") {
	if (!base || typeof base !== "object") {
		assert.equal(candidate, base, `${path} changed an existing value`);
		return;
	}
	assert(candidate && typeof candidate === "object", `${path} removed an existing object`);
	assert.equal(Array.isArray(candidate), Array.isArray(base), `${path} changed shape`);
	if (Array.isArray(base))
		assert.equal(
			/** @type {unknown[]} */ (candidate).length,
			base.length,
			`${path} changed membership`,
		);
	if (
		["savedFeeds", "podNotes", "playedEpisodes", "playlists", "downloadedEpisodes"].some(
			(name) => path === `data.${name}`,
		)
	) {
		assert.equal(
			Object.keys(candidate).length,
			Object.keys(base).length,
			`${path} changed membership`,
		);
	}
	for (const [key, value] of Object.entries(base)) {
		assert(Object.prototype.hasOwnProperty.call(candidate, key), `${path}.${key} was removed`);
		assertAdditive(
			value,
			/** @type {Record<string, unknown>} */ (candidate)[key],
			`${path}.${key}`,
		);
	}
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
	try {
		assert(process.argv.length <= 3, "Usage: npm run size:data -- [additive-candidate.json]");
		const fixture = createLargeV2Fixture();
		const baseline = measureSnapshot(fixture);
		const rows = baseline.fields.map(
			(field) => `| ${field.name} | ${field.compact} | ${field.pretty} |`,
		);
		rows.push(
			`| Framing and separators | ${baseline.framing.compact} | ${baseline.framing.pretty} |`,
		);
		let report = [
			"## V2 persistence bytes",
			"",
			`Synthetic stress library from frozen NPR feed metadata. ${Object.keys(fixture.savedFeeds).length} feeds, ${Object.keys(fixture.playedEpisodes).length} history entries, ${baseline.distinctEpisodes} distinct saved episodes.`,
			"JSON uses UTF-8 and two-space indentation, as Obsidian writes data.json.",
			"",
			"| Collection or setting | Compact bytes | data.json bytes |",
			"| --- | ---: | ---: |",
			...rows,
			`| Total | ${baseline.compact} | ${baseline.pretty} |`,
			"",
			`${baseline.episodeCopies} episode copies; ${baseline.distinctEpisodes} distinct episodes.`,
			`Identical repeated snapshots occupy ${baseline.repeatedSnapshotBytes} compact bytes.`,
			`Description/content JSON strings occupy ${baseline.episodeTextBytes} bytes across all copies.`,
			"These diagnostics overlap; they are not removable savings.",
			"",
			"The 1500000-byte document goal is advisory; this report enforces no persistence budget.",
			`Gap: ${Math.max(0, baseline.pretty - 1_500_000)} bytes.`,
			"",
			"",
		].join("\n");
		const candidate = process.argv[2]
			? JSON.parse(readFileSync(process.argv[2], "utf8"))
			: createLargeV2Fixture(true);
		assertAdditive(fixture, candidate);
		const after = measureSnapshot(candidate);
		const baselineFields = new Map(baseline.fields.map((field) => [field.name, field]));
		const deltas = after.fields.map((field) => {
			const before = baselineFields.get(field.name);
			return `| ${field.name} | ${field.compact - (before?.compact ?? 0)} | ${field.pretty - (before?.pretty ?? 0)} |`;
		});
		if (!process.argv[2])
			report +=
				"Optional-field probe only: the candidate adds the real RSS guid as podnotesGuid to every episode copy. The baseline has no podnotesGuid fields.\n\n";
		report += [
			"### Additive optional-field overhead",
			"",
			"Existing values, array order, and membership are unchanged.",
			"",
			"| Collection or setting | Added compact bytes | Added data.json bytes |",
			"| --- | ---: | ---: |",
			...deltas,
			`| Framing and separators | ${after.framing.compact - baseline.framing.compact} | ${after.framing.pretty - baseline.framing.pretty} |`,
			`| Total | ${after.compact - baseline.compact} | ${after.pretty - baseline.pretty} |`,
			"",
			`Identical repeated snapshots occupied ${baseline.repeatedSnapshotBytes} compact bytes before optional fields. Their added compact bytes are ${after.repeatedSnapshotBytes - baseline.repeatedSnapshotBytes}. This diagnostic overlaps the collection deltas.`,
			"",
			"",
		].join("\n");
		console.log(report);
		if (process.env.GITHUB_STEP_SUMMARY)
			appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
	} catch (error) {
		console.error(
			`Persistence measurement failed: ${error instanceof Error ? error.message : error}`,
		);
		process.exitCode = 1;
	}
}
