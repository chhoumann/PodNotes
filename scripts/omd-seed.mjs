import fs from "node:fs";
import path from "node:path";
import config from "../obsidian-e2e.config.mjs";

const [output] = process.argv.slice(2);
if (!output) throw new Error("Usage: node scripts/omd-seed.mjs <data.json>");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(config.defaultData, null, "\t")}\n`);
