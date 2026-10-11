import { appendFileSync, lstatSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const path = process.argv[2] ?? "main.js";
try {
	if (process.argv.length > 3) throw new Error("Usage: npm run size -- [bundle-path]");
	if (lstatSync(path).isSymbolicLink())
		throw new Error(`${path} is a development symlink. Run npm run build first.`);
	const bundle = readFileSync(path);
	if (!bundle.length) throw new Error(`${path} is empty. Run npm run build first.`);
	const measurements = [
		{ name: "raw", bytes: bundle.length, budget: 330_000 },
		{ name: "gzip (level 9)", bytes: gzipSync(bundle, { level: 9 }).length, budget: 100_000 },
	];
	const rows = measurements.map(({ name, bytes, budget }) => {
		const overage = Math.max(0, bytes - budget);
		console.log(
			`${path} ${name}: ${bytes} bytes; budget ${budget} bytes; ${overage ? `OVER by ${overage} bytes` : `${budget - bytes} bytes remaining`}`,
		);
		if (overage) process.exitCode = 1;
		return `| ${name} | ${bytes} | ${budget} | ${overage} |`;
	});
	if (process.env.GITHUB_STEP_SUMMARY) {
		appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`## Plugin bundle bytes\n\nGzip uses level 9. Budgets use decimal bytes.\n\n| Format | Bytes | Budget | Overage |\n| --- | ---: | ---: | ---: |\n${rows.join("\n")}\n\n`,
		);
	}
} catch (error) {
	console.error(`Bundle size check failed: ${error instanceof Error ? error.message : error}`);
	process.exitCode = 1;
}
