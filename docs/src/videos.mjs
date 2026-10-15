// Renders the recorded clips in public/videos. Each `![name](/videos/<name>.mp4)`
// becomes a muted, looping `<video>` with its `<name>.webp` poster, its size, and
// a `<name>-dark.mp4` twin, and the reader's theme decides which one shows. The
// script in MarkdownContent.astro plays the one that shows.
import { existsSync } from "node:fs";
import path from "node:path";
import { screenshotSize } from "./screenshots.mjs";

// Astro bundles this module, so resolve public/ from the docs package root.
const publicDir = path.resolve("public");

const clipImg = /<img\b[^>]*\bsrc="(\/videos\/[^"]+)\.mp4"[^>]*>/g;

/** Rewrites every clip `<img>` in rendered page HTML. */
export async function withVideos(html) {
	const clips = [...new Set([...html.matchAll(clipImg)].map(([, base]) => base))];
	const sizes = new Map(
		await Promise.all(clips.map(async (base) => [base, await screenshotSize(`${base}.webp`)])),
	);
	return html.replace(clipImg, (tag, base) => {
		const alt = tag.match(/\balt="([^"]*)"/)?.[1] ?? "";
		const { width, height } = sizes.get(base);
		// Phone-width clips display smaller, as screenshots do.
		const kind = width <= 480 ? "clip narrow" : "clip";
		// Without the script, a reader gets the poster and the controls.
		const video = (file, hidden) =>
			`<video class="${kind}${hidden}" src="${file}.mp4" poster="${file}.webp" width="${width}" height="${height}" aria-label="${alt}" muted loop playsinline preload="none" controls></video>`;
		if (!existsSync(`${publicDir}${base}-dark.mp4`)) return video(base, "");
		return video(base, " dark:sl-hidden") + video(`${base}-dark`, " light:sl-hidden");
	});
}
