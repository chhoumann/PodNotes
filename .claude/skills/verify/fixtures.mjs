#!/usr/bin/env node
// Verification fixtures for PodNotes: a podcast feed served from 127.0.0.1 and a
// local audio file.
//
//   node .claude/skills/verify/fixtures.mjs feed           start or reuse the feed server, print the feed URL
//   node .claude/skills/verify/fixtures.mjs feed-b         same server, print a second feed whose episode titles repeat the first's
//   node .claude/skills/verify/fixtures.mjs transcripts    same server, print a feed whose episodes publish transcripts
//   node .claude/skills/verify/fixtures.mjs library        same server, print the URL of a JSON manifest of eight
//                                                          podcasts as PodNotes saves them (Night Owl Science's feed
//                                                          answers 404) and one more feed to add
//   node .claude/skills/verify/fixtures.mjs retitle        rename the first feed's episodes, keeping their GUIDs, until the server stops
//   node .claude/skills/verify/fixtures.mjs requests       print the paths the server has answered, oldest first
//   node .claude/skills/verify/fixtures.mjs audio [path]   write a 60 s WAV into this worktree's vault
//                                                          (default path: "Fixtures/Local Fixture.wav")
//   node .claude/skills/verify/fixtures.mjs stop           stop the feed server
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRunnerConfig, resolveProvisionOptions } from "obsidian-e2e/runner";
import { FIXTURE_HOST } from "../../../scripts/e2e-instance.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
// Stable per worktree, so a feed saved in the vault keeps working across restarts.
const port = 20000 + (crypto.createHash("sha256").update(root).digest().readUInt16BE(0) % 20000);
const host = FIXTURE_HOST;
const base = `http://${host}:${port}`;
const feedUrl = `${base}/feed.xml`;
const feedBUrl = `${base}/feed-b.xml`;
const transcriptsUrl = `${base}/transcripts.xml`;
const libraryUrl = `${base}/library.json`;
const local = `http://127.0.0.1:${port}`;
const FEED_TITLE = "PodNotes Fixture";
const FEED_B_TITLE = "PodNotes Fixture B";
const TRANSCRIPTS_TITLE = "PodNotes Transcripts";
const transcriptFixtures = path.join(root, "tests/fixtures/transcripts");

function wav(seconds = 60) {
	const rate = 8000;
	const samples = rate * seconds;
	const buffer = Buffer.alloc(44 + samples * 2);
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + samples * 2, 4);
	buffer.write("WAVEfmt ", 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(rate, 24);
	buffer.writeUInt32LE(rate * 2, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++) {
		buffer.writeInt16LE(
			Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / rate)),
			44 + i * 2,
		);
	}
	return buffer;
}

const RETITLED = ["", "Renamed Opening Show", "Renamed Closing Show"];

/** @param {number} audioBytes @param {string} title @param {string} prefix @param {boolean} [retitled] */
function feedXml(audioBytes, title, prefix, retitled = false) {
	/** @param {number} n @param {string} date */
	const item = (n, date) => `
		<item>
			<title>${retitled ? RETITLED[n] : `Fixture Episode ${n}`}</title>
			<guid isPermaLink="false">podnotes-fixture${prefix}-${n}</guid>
			<pubDate>${date}</pubDate>
			<description>Fixture episode ${n} for PodNotes verification.</description>
			<enclosure url="${base}${prefix}/episode-${n}.wav" type="audio/wav" length="${audioBytes}"/>
			<itunes:duration>60</itunes:duration>
		</item>`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
	<channel>
		<title>${title}</title>
		<link>${base}/</link>
		<description>A local feed for PodNotes verification.</description>
		<itunes:author>PodNotes</itunes:author>
		<itunes:image href="${base}${prefix}/artwork.svg"/>
		${item(2, "Sat, 10 Oct 2026 09:00:00 GMT")}
		${item(1, "Fri, 09 Oct 2026 09:00:00 GMT")}
	</channel>
</rss>
`;
}

/** @param {string} title @param {string} color */
const artwork = (
	title,
	color,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
	<rect width="600" height="600" fill="${color}"/>
	<text x="300" y="320" font-family="sans-serif" font-size="64" fill="#fff" text-anchor="middle">${title}</text>
</svg>`;

/** @param {number} audioBytes */
function transcriptsFeedXml(audioBytes) {
	/** @param {number} n @param {string} title @param {string} links */
	const item = (n, title, links) => `
		<item>
			<title>${title}</title>
			<guid isPermaLink="false">podnotes-transcripts-${n}</guid>
			<pubDate>${new Date(Date.UTC(2026, 9, 10 - n, 9)).toUTCString()}</pubDate>
			<description>${title} for PodNotes verification.</description>
			<enclosure url="${base}/t/episode-${n}.wav" type="audio/wav" length="${audioBytes}"/>
			<itunes:duration>60</itunes:duration>${links}
		</item>`;
	const link = (/** @type {string} */ url, /** @type {string} */ type) =>
		`\n\t\t\t<podcast:transcript url="${url}" type="${type}"/>`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
	<channel>
		<title>${TRANSCRIPTS_TITLE}</title>
		<link>${base}/</link>
		<description>A local feed whose episodes publish transcripts.</description>
		<itunes:author>PodNotes</itunes:author>
		<itunes:image href="${base}/t/artwork.svg"/>
		${item(1, "VTT Episode", link(`${base}/t/buzzcast.html`, "text/html") + link("t/podnews.vtt", "text/vtt"))}
		${item(2, "SRT Episode", link(`${base}/t/build-your-saas.srt`, "application/x-subrip"))}
		${item(3, "JSON Episode", link(`${base}/t/build-your-saas.json`, "application/json"))}
		${item(4, "Untranscribed Episode", "")}
		${item(5, "Broken Transcript Episode", link(`${base}/t/missing.vtt`, "text/vtt"))}
	</channel>
</rss>
`;
}

/** @param {string} file */
const transcript = (file) => fs.readFileSync(path.join(transcriptFixtures, file));

/**
 * @typedef {object} LibraryPodcast
 * @property {string} slug
 * @property {string} title
 * @property {string} author
 * @property {[from: string, to: string, ink: string]} colors
 * @property {string} [label] The artwork's text, when the title is too long for it.
 * @property {boolean} [lower] Keep the artwork's text in mixed case.
 * @property {boolean} [missing] The feed answers 404.
 * @property {[title: string, date: string, seconds: number][]} episodes
 */

// The design prototype's sample library, so captures compare with its screens.
/** @type {LibraryPodcast[]} */
const LIBRARY = [
	{
		slug: "field-notes",
		title: "Field Notes",
		author: "Maya Lind",
		colors: ["#0b5d4b", "#3fae86", "#f2fff9"],
		episodes: [
			["#214 Reading slowly in a fast world", "2026-10-09", 2892],
			[
				"#213 How to remember everything you read: memory palaces, spaced repetition and the surprising science of forgetting, with Dr. Ana Ilić",
				"2026-10-02",
				4350,
			],
			["#212 The commonplace book, revisited", "2026-09-25", 3303],
			["#211 Notes from the field: a week of walking in Kyoto", "2026-09-18", 2507],
			["#210 Why we stopped writing letters", "2026-09-11", 3800],
			["#209 Index cards and the art of the small idea", "2026-09-04", 2285],
			["#208 Listening as a practice", "2026-08-28", 3160],
			["Bonus: listener Q&A, summer edition", "2026-08-21", 1752],
			["#206 What a good margin note looks like", "2026-08-14", 2710],
			["#205 The notebook as a time machine", "2026-08-07", 2950],
			["#204 Learning to draw what you see", "2026-07-31", 2640],
		],
	},
	{
		slug: "the-archive-hour",
		title: "The Archive Hour: Conversations on Memory, Notes and the Craft of Thinking Well",
		label: "The Archive Hour",
		author: "Archive Hour Media",
		colors: ["#131d36", "#2b3f6b", "#f2c66b"],
		episodes: [
			["Luhmann's slip box, forty years later", "2026-10-06", 4020],
			["Commonplace books from Locke to Obsidian", "2026-09-22", 3720],
		],
	},
	{
		slug: "slow-thinking",
		title: "Slow Thinking",
		author: "Jonas Berg",
		colors: ["#f1e6d3", "#d8c19c", "#3b2f22"],
		lower: true,
		episodes: [
			["The case for boredom", "2026-10-08", 2640],
			["Attention is a muscle (and other bad metaphors)", "2026-09-24", 3060],
			["Walking as thinking", "2026-09-10", 2280],
		],
	},
	{
		slug: "signal-and-noise",
		title: "Signal & Noise",
		author: "Northwind Radio",
		colors: ["#0f1215", "#26333d", "#7cf0d0"],
		episodes: [
			[
				"Ep. 88: What the weather models get wrong, and why forecasters still trust them",
				"2026-10-07",
				3660,
			],
			["Ep. 87: The quiet economics of open source", "2026-09-23", 3420],
		],
	},
	{
		slug: "lunch-break-history",
		title: "Lunch Break History",
		author: "Priya Natarajan",
		colors: ["#b93b0b", "#f0a01c", "#fff7ed"],
		episodes: [
			["The library of Alexandria did not burn in a day", "2026-10-10", 1560],
			["Who invented the index?", "2026-10-03", 1440],
			["Medieval monks and the first sticky notes", "2026-09-26", 1500],
		],
	},
	{
		slug: "night-owl-science",
		title: "Night Owl Science",
		author: "Owl House Audio",
		colors: ["#1e1b4b", "#5b2bb3", "#ede9fe"],
		missing: true,
		episodes: [
			["Sleep, memory and the 3 a.m. idea", "2026-09-30", 2220],
			["Why octopuses dream", "2026-09-16", 2520],
			["The science of awe", "2026-09-02", 2400],
		],
	},
	{
		slug: "making-sense-of-markets",
		title: "Making Sense of Markets",
		author: "Tom Okafor",
		colors: ["#0c4a6e", "#0e98b8", "#ecfeff"],
		episodes: [["Rates, explained without the jargon", "2026-10-09", 1980]],
	},
	{
		slug: "small-rooms",
		title: "Small Rooms",
		author: "Studio Fen",
		colors: ["#fbd3e9", "#f9a8b4", "#4c0519"],
		lower: true,
		episodes: [["A desk by the window", "2026-09-29", 1260]],
	},
];

/** @type {LibraryPodcast} */
const ADD_PODCAST = {
	slug: "notes-from-the-archive",
	title: "Notes from the Archive",
	author: "Hannah Sewell",
	colors: ["#4a1d6b", "#c0399b", "#fdf4ff"],
	episodes: [
		["Letters in the attic", "2026-10-07", 2460],
		["The archivist's toolkit", "2026-09-30", 2810],
		["What gets kept, and why", "2026-09-23", 3020],
	],
};

/** @param {string} text */
const xml = (text) =>
	text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** @param {LibraryPodcast} podcast */
function libraryFeed({ slug, title, author }) {
	return {
		title,
		url: `${base}/library/${slug}.xml`,
		artworkUrl: `${base}/library/${slug}.svg`,
		link: `${base}/`,
		description: `${title}, by ${author}.`,
		author,
	};
}

/** @param {LibraryPodcast} podcast @param {number} audioBytes */
function libraryFeedXml(podcast, audioBytes) {
	const feed = libraryFeed(podcast);
	const items = podcast.episodes.map(
		([title, date, seconds], n) => `
		<item>
			<title>${xml(title)}</title>
			<guid isPermaLink="false">podnotes-library-${podcast.slug}-${n}</guid>
			<pubDate>${new Date(`${date}T12:00:00Z`).toUTCString()}</pubDate>
			<description>${xml(title)}.</description>
			<enclosure url="${base}/library/${podcast.slug}/${n}.wav" type="audio/wav" length="${audioBytes}"/>
			<itunes:duration>${seconds}</itunes:duration>
		</item>`,
	);
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
	<channel>
		<title>${xml(feed.title)}</title>
		<link>${feed.link}</link>
		<description>${xml(feed.description)}</description>
		<itunes:author>${xml(feed.author)}</itunes:author>
		<itunes:image href="${feed.artworkUrl}"/>${items.join("")}
	</channel>
</rss>
`;
}

/** @param {LibraryPodcast} podcast */
function libraryArtwork({ title, label = title, colors: [from, to, ink], lower }) {
	/** @type {string[]} */
	const lines = [];
	for (const word of (lower ? label : label.toUpperCase()).split(" ")) {
		const last = lines.length - 1;
		if (last >= 0 && `${lines[last]} ${word}`.length <= 10) lines[last] += ` ${word}`;
		else lines.push(word);
	}
	const text = lines
		.map(
			(line, i) =>
				`<text x="300" y="${550 - (lines.length - 1 - i) * 80}">${xml(line)}</text>`,
		)
		.join("");
	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
	<defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
	<rect width="600" height="600" fill="url(#g)"/>
	<g font-family="sans-serif" font-size="76" font-weight="700" fill="${ink}" text-anchor="middle">${text}</g>
</svg>`;
}

/**
 * The library as PodNotes saves it: each feed as it was added, and its episodes
 * as the feed lists them, ready for a queue or a playlist.
 */
function libraryManifest() {
	return {
		feeds: LIBRARY.map((podcast) => {
			const feed = libraryFeed(podcast);
			return {
				feed,
				missing: podcast.missing === true,
				episodes: podcast.episodes.map(([title, date, seconds], n) => ({
					title,
					streamUrl: `${base}/library/${podcast.slug}/${n}.wav`,
					url: feed.url,
					description: `${title}.`,
					content: "",
					podcastName: feed.title,
					artworkUrl: feed.artworkUrl,
					episodeDate: `${date}T12:00:00.000Z`,
					feedUrl: feed.url,
					itunesTitle: "",
					duration: seconds,
					mediaType: "audio",
				})),
			};
		}),
		add: libraryFeed(ADD_PODCAST),
	};
}

function serve() {
	const audio = wav();
	/** @type {Record<string, [string, Buffer]>} */
	const routes = {
		"/feed.xml": ["application/rss+xml", Buffer.from(feedXml(audio.length, FEED_TITLE, ""))],
		"/artwork.svg": ["image/svg+xml", Buffer.from(artwork(FEED_TITLE, "#7c3aed"))],
		"/episode-1.wav": ["audio/wav", audio],
		"/episode-2.wav": ["audio/wav", audio],
		"/feed-b.xml": [
			"application/rss+xml",
			Buffer.from(feedXml(audio.length, FEED_B_TITLE, "/b")),
		],
		"/b/artwork.svg": ["image/svg+xml", Buffer.from(artwork(FEED_B_TITLE, "#0f766e"))],
		"/b/episode-1.wav": ["audio/wav", audio],
		"/b/episode-2.wav": ["audio/wav", audio],
		"/transcripts.xml": ["application/rss+xml", Buffer.from(transcriptsFeedXml(audio.length))],
		"/t/artwork.svg": ["image/svg+xml", Buffer.from(artwork("Transcripts", "#b45309"))],
		"/t/buzzcast.html": ["text/html; charset=utf-8", transcript("buzzcast.html")],
		"/t/podnews.vtt": ["text/vtt; charset=utf-8", transcript("podnews-2026-10-05.vtt")],
		"/t/build-your-saas.srt": ["application/x-subrip", transcript("build-your-saas.srt")],
		"/t/build-your-saas.json": ["application/json", transcript("build-your-saas.json")],
	};
	for (let n = 1; n <= 5; n++) routes[`/t/episode-${n}.wav`] = ["audio/wav", audio];
	routes["/library.json"] = ["application/json", Buffer.from(JSON.stringify(libraryManifest()))];
	for (const podcast of [...LIBRARY, ADD_PODCAST]) {
		routes[`/library/${podcast.slug}.svg`] = [
			"image/svg+xml",
			Buffer.from(libraryArtwork(podcast)),
		];
		if (!podcast.missing) {
			routes[`/library/${podcast.slug}.xml`] = [
				"application/rss+xml",
				Buffer.from(libraryFeedXml(podcast, audio.length)),
			];
		}
		podcast.episodes.forEach((_, n) => {
			routes[`/library/${podcast.slug}/${n}.wav`] = ["audio/wav", audio];
		});
	}
	/** @type {string[]} */
	const requests = [];
	const server = http.createServer((request, response) => {
		if (request.method === "POST" && request.url === "/__retitle") {
			routes["/feed.xml"][1] = Buffer.from(feedXml(audio.length, FEED_TITLE, "", true));
			response.end();
			return;
		}
		if (request.method === "POST" && request.url === "/__stop") {
			server.close();
			response.end(() => process.exit(0));
			return;
		}
		if (request.url === "/__requests") {
			response.writeHead(200, { "Content-Type": "application/json" });
			response.end(JSON.stringify(requests));
			return;
		}
		const fromPodNotes = request.headers.host?.startsWith(host);
		if (fromPodNotes) requests.push(`${request.method} ${request.url}`);
		const route = routes[request.url ?? ""];
		if (!route) {
			response.writeHead(404).end();
			return;
		}
		const [type, body] = route;
		// The player seeks with Range requests, so serve 206 partial content.
		const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
		if (!range) {
			response.writeHead(200, {
				"Content-Type": type,
				"Content-Length": body.length,
				"Accept-Ranges": "bytes",
			});
			response.end(body);
			return;
		}
		const start = range[1] ? Number(range[1]) : body.length - Number(range[2]);
		const end =
			range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
		response.writeHead(206, {
			"Content-Type": type,
			"Content-Length": end - start + 1,
			"Content-Range": `bytes ${start}-${end}/${body.length}`,
			"Accept-Ranges": "bytes",
		});
		response.end(body.subarray(start, end + 1));
	});
	server.on("error", (error) => {
		console.error(`The fixture feed cannot listen on 127.0.0.1:${port}: ${error.message}`);
		process.exit(1);
	});
	server.listen(port, "127.0.0.1");
}

async function feedIsUp() {
	try {
		const response = await fetch(`${local}/transcripts.xml`, {
			signal: AbortSignal.timeout(1000),
		});
		return response.ok && (await response.text()).includes(TRANSCRIPTS_TITLE);
	} catch {
		return false;
	}
}

/** @param {string} url */
async function startFeed(url) {
	if (!(await feedIsUp())) {
		const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "serve"], {
			detached: true,
			stdio: ["ignore", "ignore", "pipe"],
		});
		let failure = "";
		let exited = false;
		child.stderr.setEncoding("utf8").on("data", (chunk) => (failure += chunk));
		child.on("close", () => (exited = true));
		try {
			let up = false;
			const deadline = Date.now() + 5000;
			while (!(up = await feedIsUp()) && !exited && Date.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
			if (!up) {
				child.kill();
				throw new Error(failure.trim() || `The fixture feed did not come up at ${local}.`);
			}
		} finally {
			child.stderr.destroy();
			child.unref();
		}
	}
	console.log(url);
}

async function writeAudio(vaultRelativePath = "Fixtures/Local Fixture.wav") {
	const config = await loadRunnerConfig(root);
	const { vaultPath } = resolveProvisionOptions({}, config, root);
	const file = path.join(vaultPath, vaultRelativePath);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, wav());
	console.log(file);
}

async function printRequests() {
	const response = await fetch(`${local}/__requests`, { signal: AbortSignal.timeout(1000) });
	for (const line of /** @type {string[]} */ (await response.json())) console.log(line);
}

async function retitleFeed() {
	const response = await fetch(`${local}/__retitle`, {
		method: "POST",
		signal: AbortSignal.timeout(1000),
	});
	if (!response.ok)
		throw new Error("The fixture feed is not running. Run fixtures.mjs feed first.");
	console.log(RETITLED.slice(1).join("\n"));
}

async function stopFeed() {
	await fetch(`${local}/__stop`, {
		method: "POST",
		signal: AbortSignal.timeout(1000),
	}).catch(() => {});
}

const [verb, arg] = process.argv.slice(2);
try {
	if (verb === "serve") serve();
	else if (verb === "feed") await startFeed(feedUrl);
	else if (verb === "feed-b") await startFeed(feedBUrl);
	else if (verb === "transcripts") await startFeed(transcriptsUrl);
	else if (verb === "library") await startFeed(libraryUrl);
	else if (verb === "retitle") await retitleFeed();
	else if (verb === "requests") await printRequests();
	else if (verb === "audio") await writeAudio(arg);
	else if (verb === "stop") await stopFeed();
	else
		throw new Error(
			"Usage: fixtures.mjs feed | feed-b | transcripts | library | retitle | requests | audio [vault-relative path] | stop",
		);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
