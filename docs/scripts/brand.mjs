// Builds the site's icons from the one source mark, public/brand/podnotes-mark.svg.
// Run from the repo root after changing the mark:
//
//   node docs/scripts/brand.mjs
//
// The mark sits on a 16 px grid (4 units per pixel), so the 16 px favicon stays
// sharp.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const publicDir = fileURLToPath(new URL("../public", import.meta.url));
const source = path.join(publicDir, "brand", "podnotes-mark.svg");
const svg = await fs.readFile(source);
const tile = svg.toString().match(/<rect width="64" height="64"[^>]*fill="([^"]+)"/)[1];

// Rasterizes the 64-unit mark at `size` pixels, oversampled for clean edges.
const render = (size) => sharp(svg, { density: (72 * size * 4) / 64 }).resize(size, size);

await fs.copyFile(source, path.join(publicDir, "favicon.svg"));
for (const size of [16, 32]) {
	await render(size)
		.png()
		.toFile(path.join(publicDir, `favicon-${size}.png`));
}
// iOS rounds the icon itself and fills transparent corners with black, so the
// touch icon is a full square in the tile color.
await render(180)
	.flatten({ background: tile })
	.png()
	.toFile(path.join(publicDir, "apple-touch-icon.png"));
console.log(`Wrote icons from ${path.relative(process.cwd(), source)}`);
