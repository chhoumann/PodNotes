import { execFileSync } from "node:child_process";
import fs from "node:fs";

/** @param {Buffer} png */
export function pngSize(png) {
	return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** @param {{ file: string, caption: string }[][]} rows @param {string} out */
export function contactSheet(rows, out) {
	const GAP = 16;
	const CAPTION = 28;
	const cells = [];
	const layout = [];
	let y = GAP;
	for (const row of rows) {
		let x = GAP;
		let tallest = 0;
		for (const cell of row) {
			const size = pngSize(fs.readFileSync(cell.file));
			cells.push(cell);
			layout.push(`${x}_${y}`);
			x += size.width + GAP;
			tallest = Math.max(tallest, size.height + CAPTION);
		}
		y += tallest + GAP;
	}
	const labelled = cells.map(
		(cell, i) =>
			`[${i}:v]format=rgb24,pad=iw:ih+${CAPTION}:0:${CAPTION}:color=0x5c5c5c,` +
			`drawtext=font=Sans:fontsize=15:fontcolor=white:x=2:y=7:text='${cell.caption}'[c${i}]`,
	);
	const stacked =
		cells.length === 1
			? "[c0]null"
			: `${cells.map((_, i) => `[c${i}]`).join("")}xstack=inputs=${cells.length}:layout=${layout.join("|")}:fill=0x5c5c5c`;
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-y",
			...cells.flatMap((cell) => ["-i", cell.file]),
			"-filter_complex",
			`${labelled.join(";")};${stacked},pad=iw+${GAP}:ih+${GAP}:0:0:color=0x5c5c5c[out]`,
			"-map",
			"[out]",
			"-frames:v",
			"1",
			out,
		],
		{ stdio: ["ignore", "ignore", "inherit"] },
	);
}
