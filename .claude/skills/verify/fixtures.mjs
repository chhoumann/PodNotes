#!/usr/bin/env node
// Verification fixtures for PodNotes: a podcast feed served from 127.0.0.1 and a
// local audio file.
//
//   node .claude/skills/verify/fixtures.mjs feed           start or reuse the feed server, print the feed URL
//   node .claude/skills/verify/fixtures.mjs feed-b         same server, print a second feed whose episode titles repeat the first's
//   node .claude/skills/verify/fixtures.mjs transcripts    same server, print a feed whose episodes publish transcripts
//   node .claude/skills/verify/fixtures.mjs requests       print the paths the server has answered, oldest first
//   node .claude/skills/verify/fixtures.mjs audio [path]   write a 60 s WAV into this worktree's vault
//                                                          (default path: "Fixtures/Local Fixture.wav")
//   node .claude/skills/verify/fixtures.mjs stop           stop the feed server
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRunnerConfig, resolveProvisionOptions } from "obsidian-e2e/runner";

const root = fileURLToPath(new URL("../../..", import.meta.url));
// Stable per worktree, so a feed saved in the vault keeps working across restarts.
const port = 20000 + (crypto.createHash("sha256").update(root).digest().readUInt16BE(0) % 20000);
// assertFetchableUrl refuses literal loopback hosts, so the URL uses nip.io, a
// public DNS name for 127.0.0.1.
const host = "127.0.0.1.nip.io";
const base = `http://${host}:${port}`;
const feedUrl = `${base}/feed.xml`;
const feedBUrl = `${base}/feed-b.xml`;
const transcriptsUrl = `${base}/transcripts.xml`;
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

/** @param {number} audioBytes @param {string} title @param {string} prefix */
function feedXml(audioBytes, title, prefix) {
	/** @param {number} n @param {string} date */
	const item = (n, date) => `
		<item>
			<title>Fixture Episode ${n}</title>
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

/**
 * Each episode publishes its transcripts the way real hosts do. The VTT link is
 * relative to the feed URL and follows an HTML link, so selection and URL
 * resolution both show in the result.
 * @param {number} audioBytes
 */
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
	/** @type {string[]} */
	const requests = [];
	const server = http.createServer((request, response) => {
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
		// Only PodNotes uses the nip.io host; this script's own probes use 127.0.0.1.
		if (request.headers.host?.startsWith(host))
			requests.push(`${request.method} ${request.url}`);
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
	await dns.lookup(host).catch(() => {
		console.error(`${host} does not resolve here; PodNotes needs DNS to reach this feed URL.`);
	});
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
	else if (verb === "requests") await printRequests();
	else if (verb === "audio") await writeAudio(arg);
	else if (verb === "stop") await stopFeed();
	else
		throw new Error(
			"Usage: fixtures.mjs feed | feed-b | transcripts | requests | audio [vault-relative path] | stop",
		);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
