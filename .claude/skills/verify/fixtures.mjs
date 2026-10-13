#!/usr/bin/env node
// Verification fixtures for PodNotes: a podcast feed served from 127.0.0.1 and a
// local audio file.
//
//   node .claude/skills/verify/fixtures.mjs feed           start or reuse the feed server, print the feed URL
//   node .claude/skills/verify/fixtures.mjs feed-b         same server, print a second feed whose episode titles repeat the first's
//   node .claude/skills/verify/fixtures.mjs transcripts    same server, print a feed whose episodes publish transcripts
//   node .claude/skills/verify/fixtures.mjs library        same server, print the URL of a JSON manifest of eight
//                                                          podcasts as PodNotes saves them (Night Owl Science's feed
//                                                          answers 404) and one more feed to add. Each episode's
//                                                          media is silence as long as its feed says. #213 has
//                                                          chapters; Signal & Noise has a video episode, a 10 s
//                                                          test pattern ffmpeg makes on first request, and an
//                                                          episode whose media answers 404
//   node .claude/skills/verify/fixtures.mjs retitle        rename the first feed's episodes, keeping their GUIDs, until the server stops
//   node .claude/skills/verify/fixtures.mjs requests       print the paths the server has answered, oldest first
//   node .claude/skills/verify/fixtures.mjs audio [path]   write a 60 s WAV into this worktree's vault
//                                                          (default path: "Fixtures/Local Fixture.wav")
//   node .claude/skills/verify/fixtures.mjs stop           stop the feed server
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
// Media made here outlives the server; node_modules/.cache is where tools keep caches.
const CACHE = path.join(root, "node_modules/.cache/podnotes-fixtures");
const RATE = 8000;
const SILENCE = Buffer.alloc(64 * 1024);

/** @typedef {{ length: number, chunks: (start: number, end: number) => Iterable<Buffer> }} Stream */

/** A 16-bit mono WAV header for `samples` samples at RATE. @param {number} samples */
function wavHeader(samples) {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0);
	header.writeUInt32LE(36 + samples * 2, 4);
	header.write("WAVEfmt ", 8);
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(RATE, 24);
	header.writeUInt32LE(RATE * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36);
	header.writeUInt32LE(samples * 2, 40);
	return header;
}

function wav(seconds = 60) {
	const samples = RATE * seconds;
	const data = Buffer.alloc(samples * 2);
	for (let i = 0; i < samples; i++) {
		data.writeInt16LE(Math.round(3000 * Math.sin((2 * Math.PI * 440 * i) / RATE)), i * 2);
	}
	return Buffer.concat([wavHeader(samples), data]);
}

/**
 * Silence as long as an episode, made as it is sent, so an hour costs no memory and the
 * player can seek anywhere in it with Range requests.
 * @param {number} seconds @returns {Stream}
 */
function silentWav(seconds) {
	const header = wavHeader(RATE * seconds);
	return {
		length: header.length + RATE * seconds * 2,
		*chunks(start, end) {
			if (start < header.length)
				yield header.subarray(start, Math.min(end + 1, header.length));
			for (let at = Math.max(start, header.length); at <= end; at += SILENCE.length) {
				yield SILENCE.subarray(0, Math.min(SILENCE.length, end + 1 - at));
			}
		},
	};
}

/**
 * ffmpeg's test pattern, which prints its own time, kept in CACHE for later servers.
 * @param {number} seconds
 */
async function testPattern(seconds) {
	const file = path.join(CACHE, `test-pattern-${seconds}s.mp4`);
	if (!fs.existsSync(file)) {
		fs.mkdirSync(CACHE, { recursive: true });
		const scratch = `${file}.${process.pid}.mp4`;
		await promisify(execFile)("ffmpeg", [
			..."-v error -y -f lavfi -i testsrc2=size=640x360:rate=25 -f lavfi -i anullsrc".split(
				" ",
			),
			..."-c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 8k -movflags +faststart".split(" "),
			"-t",
			String(seconds),
			scratch,
		]);
		fs.renameSync(scratch, file);
	}
	return fs.readFileSync(file);
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
 * @property {[title: string, date: string, seconds: number, extra?: EpisodeExtra][]} episodes
 */

/**
 * @typedef {object} EpisodeExtra
 * @property {[startTime: number, title: string][]} [chapters] Podcasting 2.0 JSON chapters.
 * @property {boolean} [video] The media is the test pattern.
 * @property {boolean} [missing] The media answers 404.
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
				{
					chapters: [
						[0, "Intro"],
						[220, "Why we forget"],
						[845, "The forgetting curve"],
						[1650, "Memory palaces 101"],
						[2172, "The method of loci in practice"],
						[2990, "Spaced repetition without the apps"],
						[3738, "Reading with a pen"],
						[4180, "Listener question"],
					],
				},
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
			// Older than every other episode, so the list pages' first screens stay the prototype's.
			["Ep. 86: Inside the radar room (video)", "2026-07-15", 10, { video: true }],
			["Ep. 85: When the radio towers went quiet", "2026-07-01", 3480, { missing: true }],
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

/**
 * Where an episode's media and chapters are served. The test pattern is made on request,
 * so its enclosure length is 0, as RSS has it for a size not known in advance.
 * @param {LibraryPodcast} podcast @param {number} n
 */
function libraryMedia({ slug, episodes }, n) {
	const [, , seconds, extra] = episodes[n];
	const route = `/library/${slug}/${n}`;
	return {
		route,
		...(extra?.video
			? { file: `${route}.mp4`, type: "video/mp4", length: 0 }
			: { file: `${route}.wav`, type: "audio/wav", length: silentWav(seconds).length }),
		chaptersUrl: extra?.chapters && `${base}${route}.json`,
	};
}

/** @param {LibraryPodcast} podcast */
function libraryFeedXml(podcast) {
	const feed = libraryFeed(podcast);
	const items = podcast.episodes.map(([title, date, seconds], n) => {
		const media = libraryMedia(podcast, n);
		return `
		<item>
			<title>${xml(title)}</title>
			<guid isPermaLink="false">podnotes-library-${podcast.slug}-${n}</guid>
			<pubDate>${new Date(`${date}T12:00:00Z`).toUTCString()}</pubDate>
			<description>${xml(title)}.</description>
			<enclosure url="${base}${media.file}" type="${media.type}" length="${media.length}"/>
			<itunes:duration>${seconds}</itunes:duration>${media.chaptersUrl ? `\n\t\t\t<podcast:chapters url="${media.chaptersUrl}" type="application/json+chapters"/>` : ""}
		</item>`;
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
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

function libraryManifest() {
	return {
		feeds: LIBRARY.map((podcast) => {
			const feed = libraryFeed(podcast);
			return {
				feed,
				missing: podcast.missing === true,
				episodes: podcast.episodes.map(([title, date, seconds, extra], n) => {
					const { file, chaptersUrl } = libraryMedia(podcast, n);
					return {
						title,
						streamUrl: `${base}${file}`,
						url: feed.url,
						description: `${title}.`,
						content: "",
						podcastName: feed.title,
						artworkUrl: feed.artworkUrl,
						episodeDate: `${date}T12:00:00.000Z`,
						feedUrl: feed.url,
						itunesTitle: "",
						duration: seconds,
						...(chaptersUrl && { chaptersUrl }),
						mediaType: extra?.video ? "video" : "audio",
					};
				}),
			};
		}),
		add: libraryFeed(ADD_PODCAST),
	};
}

function serve() {
	const audio = wav();
	/** @type {Record<string, [string, Buffer | Stream]>} */
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
	// Made on their first request, so the server starts without ffmpeg.
	/** @type {Record<string, () => Promise<Buffer>>} */
	const videos = {};
	for (const podcast of [...LIBRARY, ADD_PODCAST]) {
		routes[`/library/${podcast.slug}.svg`] = [
			"image/svg+xml",
			Buffer.from(libraryArtwork(podcast)),
		];
		if (!podcast.missing) {
			routes[`/library/${podcast.slug}.xml`] = [
				"application/rss+xml",
				Buffer.from(libraryFeedXml(podcast)),
			];
		}
		podcast.episodes.forEach(([, , seconds, extra], n) => {
			const { route, file } = libraryMedia(podcast, n);
			if (extra?.chapters) {
				const chapters = extra.chapters.map(([startTime, title]) => ({ startTime, title }));
				routes[`${route}.json`] = [
					"application/json+chapters",
					Buffer.from(JSON.stringify({ version: "1.2.0", chapters })),
				];
			}
			if (extra?.video) {
				/** @type {Promise<Buffer> | undefined} */
				let made;
				// A failed run is dropped, so the next request tries again.
				videos[file] = () =>
					(made ??= testPattern(seconds).catch((error) => {
						made = undefined;
						throw error;
					}));
			} else if (!extra?.missing) {
				routes[file] = ["audio/wav", silentWav(seconds)];
			}
		});
	}
	/** @type {string[]} */
	const requests = [];
	const server = http.createServer(async (request, response) => {
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
		const url = request.url ?? "";
		let route = routes[url];
		if (!route && videos[url]) {
			try {
				route = ["video/mp4", await videos[url]()];
			} catch (error) {
				response.writeHead(500).end(String(error));
				return;
			}
		}
		if (!route) {
			response.writeHead(404).end();
			return;
		}
		const [type, body] = route;
		/** @param {number} start @param {number} end */
		const send = (start, end) =>
			Buffer.isBuffer(body)
				? response.end(body.subarray(start, end + 1))
				: pipeline(Readable.from(body.chunks(start, end)), response, () => {});
		// The player seeks with Range requests, so serve 206 partial content.
		const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
		if (!range) {
			response.writeHead(200, {
				"Content-Type": type,
				"Content-Length": body.length,
				"Accept-Ranges": "bytes",
				// As a podcast host serves artwork, so covers seen once still show offline.
				...(type.startsWith("image/") && { "Cache-Control": "max-age=86400" }),
			});
			send(0, body.length - 1);
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
		send(start, end);
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
