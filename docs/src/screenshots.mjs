// Renders the captured screenshots in public/screenshots. Each
// `![alt](/screenshots/<name>.webp)` gets its size, lazy loading, and a
// `<name>-dark.webp` twin, and the reader's theme decides which one shows.
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Astro bundles this module, so resolve public/ from the docs package root.
const publicDir = path.resolve("public");

export const darkTwin = (src) => src.replace(/\.webp$/, "-dark.webp");

/** The screenshots are captured at 2x, so they display at half their pixel size. */
export async function screenshotSize(src) {
	const { width, height } = await sharp(publicDir + src).metadata();
	return { width: width / 2, height: height / 2 };
}

const screenshotImg = /<img\b[^>]*\bsrc="(\/screenshots\/[^"]+\.webp)"[^>]*>/g;

/** Rewrites every screenshot `<img>` in rendered page HTML. */
export async function withScreenshots(html) {
	const sources = [...new Set([...html.matchAll(screenshotImg)].map((match) => match[1]))];
	const sizes = new Map(
		await Promise.all(sources.map(async (src) => [src, await screenshotSize(src)])),
	);
	return html.replace(screenshotImg, (tag, src) => {
		const alt = tag.match(/\balt="([^"]*)"/)?.[1] ?? "";
		const { width, height } = sizes.get(src);
		const img = (file, hidden) =>
			`<img src="${file}" alt="${alt}" width="${width}" height="${height}" loading="lazy" decoding="async" class="screenshot${hidden ? ` ${hidden}` : ""}">`;
		if (!existsSync(publicDir + darkTwin(src))) return img(src, "");
		return img(src, "dark:sl-hidden") + img(darkTwin(src), "light:sl-hidden");
	});
}
