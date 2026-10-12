// Renders the captured screenshots in public/screenshots. Each
// `![alt](/screenshots/<name>.webp)` gets its size, lazy loading, and a
// `<name>-dark.webp` twin, and the reader's theme decides which one shows.
// A `<name>-phone.webp` crop, if one exists, replaces it on narrow screens.
import { existsSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

// Astro bundles this module, so resolve public/ from the docs package root.
const publicDir = path.resolve("public");

export const darkTwin = (src) => src.replace(/\.webp$/, "-dark.webp");

const phoneTwin = (src) => src.replace(/\.webp$/, "-phone.webp");

/** The screenshots are captured at 2x, so they display at half their pixel size. */
export async function screenshotSize(src) {
	const { width, height } = await sharp(publicDir + src).metadata();
	return { width: width / 2, height: height / 2 };
}

const screenshotImg = /<img\b[^>]*\bsrc="(\/screenshots\/[^"]+\.webp)"[^>]*>/g;

/** Rewrites every screenshot `<img>` in rendered page HTML. */
export async function withScreenshots(html) {
	const files = [...html.matchAll(screenshotImg)].flatMap(([, src]) => [src, phoneTwin(src)]);
	const sizes = new Map(
		await Promise.all(
			[...new Set(files)]
				.filter((src) => existsSync(publicDir + src))
				.map(async (src) => [src, await screenshotSize(src)]),
		),
	);
	return html.replace(screenshotImg, (tag, src) => {
		const alt = tag.match(/\balt="([^"]*)"/)?.[1] ?? "";
		const { width, height } = sizes.get(src);
		// Sidebar-width shots display smaller, so they do not tower over the text.
		const kind = width <= 480 ? "screenshot narrow" : "screenshot";
		const phone = sizes.get(phoneTwin(src));
		const picture = (twin, hidden) => {
			const img = `<img src="${twin(src)}" alt="${alt}" width="${width}" height="${height}" loading="lazy" decoding="async" class="${kind}">`;
			const source = phone
				? `<source media="(max-width: 40rem)" srcset="${twin(phoneTwin(src))}" width="${phone.width}" height="${phone.height}">`
				: "";
			return `<picture${hidden ? ` class="${hidden}"` : ""}>${source}${img}</picture>`;
		};
		const same = (file) => file;
		if (!existsSync(publicDir + darkTwin(src))) return picture(same, "");
		return picture(same, "dark:sl-hidden") + picture(darkTwin, "light:sl-hidden");
	});
}
