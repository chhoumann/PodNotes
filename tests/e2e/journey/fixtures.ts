import http from "node:http";
import type { AddressInfo } from "node:net";
import type { ObsidianClient } from "obsidian-e2e";
import { FIXTURE_HOST } from "../../../scripts/e2e-instance.mjs";
import { jsLiteral } from "../runtime";

export type FixtureTranscript = Readonly<{
	path: string;
	type: string;
	absolute?: boolean;
	body?: string;
}>;

export type FixtureEpisode = Readonly<{
	title: string;
	seconds: number | null;
	pubDate?: string;
	omitTitle?: boolean;
	description?: string;
	guid?: string;
	transcripts?: readonly FixtureTranscript[];
}>;

export type FixtureFeed = Readonly<{
	title: string;
	slug: string;
	query?: string;
	/** The feed's own host and path, where the slug's would not do; media keeps the slug's. */
	host?: string;
	path?: string;
	artwork: boolean;
	episodes: readonly FixtureEpisode[];
}>;

export type FixtureServer = Readonly<{
	feedUrl(feed: FixtureFeed): string;
	mediaUrl(feed: FixtureFeed, episode: FixtureEpisode): string;
	artworkUrl(feed: FixtureFeed): string;
	audio(feed: FixtureFeed, episode: FixtureEpisode): Buffer;
	holdFeed(feed: FixtureFeed): () => Promise<void>;
	/** Answers the feed with a server error until the returned restore runs. */
	failFeed(feed: FixtureFeed): () => void;
	/** Serves `episode` under `title` from now on, with its GUID and media unchanged. */
	retitle(feed: FixtureFeed, episode: FixtureEpisode, title: string): void;
	requests(): readonly string[];
	stop(): Promise<void>;
}>;

const SAMPLE_RATE = 8000;

export function pubDate(daysBefore: number): string {
	return new Date(Date.UTC(2026, 9, 10, 9) - daysBefore * 86_400_000).toUTCString();
}

export async function startFixtureServer(feeds: readonly FixtureFeed[]): Promise<FixtureServer> {
	const requests: string[] = [];
	const routes = new Map<string, { type: string; body: Buffer; cache?: boolean }>();
	const holds = new Map<
		string,
		{ ready: Promise<void>; release: () => void; done: Promise<void>; complete: () => void }
	>();
	const failing = new Set<string>();
	const server = http.createServer((request, response) => {
		const path = request.url ?? "";
		requests.push(path);
		if (failing.has(path)) {
			response.writeHead(503).end();
			return;
		}
		const route = routes.get(path);
		if (!route) {
			response.writeHead(404).end();
			return;
		}
		const held = holds.get(path);
		const serve = () =>
			serveRange(request, response, route.type, route.body, route.cache === true);
		if (held) {
			response.once("finish", held.complete);
			response.once("close", held.complete);
			void held.ready.then(serve);
		} else serve();
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address() as AddressInfo;
	const origin = `http://${FIXTURE_HOST}:${port}`;

	const feedPath = (feed: FixtureFeed) =>
		`${feed.path ?? `/${feed.slug}/feed.xml`}${feed.query ?? ""}`;
	const feedUrl = (feed: FixtureFeed) =>
		`http://${feed.host ?? FIXTURE_HOST}:${port}${feedPath(feed)}`;
	const artworkUrl = (feed: FixtureFeed) => `${origin}/${feed.slug}/artwork.svg`;
	const mediaPath = (feed: FixtureFeed, episode: FixtureEpisode) =>
		`/${feed.slug}/${feed.episodes.indexOf(episode) + 1}.wav`;
	const audio = (feed: FixtureFeed, episode: FixtureEpisode) => {
		const route = routes.get(mediaPath(feed, episode));
		if (!route) throw new Error(`${feed.title} / ${episode.title} has no audio.`);
		return route.body;
	};

	const serveFeed = (feed: FixtureFeed) =>
		routes.set(feedPath(feed), {
			type: "application/rss+xml",
			body: Buffer.from(
				rss(
					feed,
					feed.artwork ? artworkUrl(feed) : null,
					(episode) =>
						episode.seconds === null
							? null
							: {
									url: `${origin}${mediaPath(feed, episode)}`,
									bytes: audio(feed, episode).length,
								},
					(transcript) =>
						transcript.absolute
							? `${origin}/${feed.slug}/${transcript.path}`
							: transcript.path,
				),
			),
		});

	for (const feed of feeds) {
		feed.episodes.forEach((episode, index) => {
			if (episode.seconds !== null) {
				const body = wav(episode.seconds, 300 + 40 * index + 7 * feed.slug.length);
				routes.set(mediaPath(feed, episode), { type: "audio/wav", body });
			}
			for (const transcript of episode.transcripts ?? []) {
				if (transcript.body === undefined) continue;
				routes.set(`/${feed.slug}/${transcript.path}`, {
					type: transcript.type,
					body: Buffer.from(transcript.body),
				});
			}
		});
		if (feed.artwork) {
			routes.set(`/${feed.slug}/artwork.svg`, {
				type: "image/svg+xml",
				body: Buffer.from(artworkSvg(feed.title)),
				cache: true,
			});
		}
		serveFeed(feed);
	}

	return {
		feedUrl,
		artworkUrl,
		mediaUrl: (feed, episode) => `${origin}${mediaPath(feed, episode)}`,
		audio,
		holdFeed: (feed) => {
			const path = feedPath(feed);
			let release!: () => void;
			let complete!: () => void;
			const ready = new Promise<void>((resolve) => {
				release = resolve;
			});
			const done = new Promise<void>((resolve) => {
				complete = resolve;
			});
			holds.set(path, { ready, release, done, complete });
			return async () => {
				holds.delete(path);
				release();
				await done;
			};
		},
		failFeed: (feed) => {
			const path = feedPath(feed);
			failing.add(path);
			return () => failing.delete(path);
		},
		retitle: (feed, episode, title) => {
			serveFeed({
				...feed,
				episodes: feed.episodes.map((each) =>
					each === episode ? { ...each, title } : each,
				),
			});
		},
		requests: () => [...requests],
		stop: () =>
			new Promise<void>((resolve) => {
				for (const hold of holds.values()) hold.release();
				server.close(() => resolve());
				server.closeAllConnections();
			}),
	};
}

export function opmlDocument(entries: ReadonlyArray<{ title: string; url: string }>): string {
	const outlines = entries
		.map(
			({ title, url }) =>
				`\t\t<outline text="${escapeXml(title)}" type="rss" xmlUrl="${escapeXml(url)}"/>`,
		)
		.join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
	<head><title>Journey subscriptions</title></head>
	<body>
${outlines}
	</body>
</opml>
`;
}

export function wav(seconds: number, frequency = 440): Buffer {
	const samples = SAMPLE_RATE * seconds;
	const buffer = Buffer.alloc(44 + samples * 2);
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + samples * 2, 4);
	buffer.write("WAVEfmt ", 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(SAMPLE_RATE, 24);
	buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++) {
		buffer.writeInt16LE(
			Math.round(3000 * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE)),
			44 + i * 2,
		);
	}
	return buffer;
}

function serveRange(
	request: http.IncomingMessage,
	response: http.ServerResponse,
	type: string,
	body: Buffer,
	cache: boolean,
): void {
	const headers = {
		"Content-Type": type,
		"Accept-Ranges": "bytes",
		...(cache ? { "Cache-Control": "public, max-age=86400" } : { "Cache-Control": "no-store" }),
	};
	const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
	if (!range) {
		response.writeHead(200, { ...headers, "Content-Length": body.length });
		response.end(body);
		return;
	}
	const start = range[1] ? Number(range[1]) : body.length - Number(range[2]);
	const end =
		range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
	response.writeHead(206, {
		...headers,
		"Content-Length": end - start + 1,
		"Content-Range": `bytes ${start}-${end}/${body.length}`,
	});
	response.end(body.subarray(start, end + 1));
}

function rss(
	feed: FixtureFeed,
	artworkUrl: string | null,
	enclosure: (episode: FixtureEpisode) => { url: string; bytes: number } | null,
	transcriptUrl: (transcript: FixtureTranscript) => string,
): string {
	const items = feed.episodes.map((episode) => {
		const media = enclosure(episode);
		return [
			"\t\t<item>",
			episode.omitTitle ? "" : `\t\t\t<title>${escapeXml(episode.title)}</title>`,
			episode.pubDate ? `\t\t\t<pubDate>${episode.pubDate}</pubDate>` : "",
			episode.guid ? `\t\t\t<guid isPermaLink="false">${escapeXml(episode.guid)}</guid>` : "",
			episode.description
				? `\t\t\t<description>${escapeXml(episode.description)}</description>`
				: "",
			media
				? `\t\t\t<enclosure url="${escapeXml(media.url)}" type="audio/wav" length="${media.bytes}"/>`
				: "",
			...(episode.transcripts ?? []).map(
				(transcript) =>
					`\t\t\t<podcast:transcript url="${escapeXml(transcriptUrl(transcript))}" type="${escapeXml(transcript.type)}"/>`,
			),
			"\t\t</item>",
		]
			.filter(Boolean)
			.join("\n");
	});
	return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:podcast="https://podcastindex.org/namespace/1.0">
	<channel>
		<title>${escapeXml(feed.title)}</title>
		<description>Journey fixture feed ${escapeXml(feed.title)}.</description>
${artworkUrl ? `\t\t<itunes:image href="${escapeXml(artworkUrl)}"/>\n` : ""}${items.join("\n")}
	</channel>
</rss>
`;
}

function artworkSvg(title: string): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">
	<rect width="600" height="600" fill="#7c3aed"/>
	<text x="300" y="320" font-family="sans-serif" font-size="48" fill="#fff" text-anchor="middle">${escapeXml(title)}</text>
</svg>`;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export type ItunesResult = Readonly<{
	collectionName: string;
	feedUrl: string;
	artworkUrl100: string;
	collectionId: string;
}>;

/**
 * Obsidian's requestUrl goes to the main process over the `request-url` IPC
 * channel, so the stub sits there; every other request passes through untouched.
 */
export async function installItunesStub(
	obsidian: ObsidianClient,
	results: readonly ItunesResult[],
): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		if (window.__podnotesJourneyItunes) throw new Error("The iTunes stub is already installed.");
		const ipc = window.electron.ipcRenderer;
		const originalSend = ipc.send;
		const results = ${jsLiteral(results)};
		const terms = [];
		const lookups = [];
		const answer = (replyChannel, found) => {
			const body = new TextEncoder().encode(JSON.stringify({ resultCount: found.length, results: found })).buffer;
			queueMicrotask(() => ipc.emit(replyChannel, {}, { status: 200, headers: { "content-type": "application/json" }, body }));
		};
		ipc.send = function (channel, replyChannel, request, ...rest) {
			const url = channel === "request-url" && typeof request?.url === "string" ? request.url : "";
			if (url.startsWith("https://itunes.apple.com/search?")) {
				terms.push(new URL(url).searchParams.get("term"));
				return answer(replyChannel, results);
			}
			if (url.startsWith("https://itunes.apple.com/lookup?")) {
				const id = new URL(url).searchParams.get("id");
				lookups.push(id);
				return answer(replyChannel, results.filter((result) => result.collectionId === id));
			}
			return originalSend.call(ipc, channel, replyChannel, request, ...rest);
		};
		window.__podnotesJourneyItunes = { ipc, originalSend, terms, lookups };
		return true;
	})()`);
}

export async function itunesSearchTerms(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>("window.__podnotesJourneyItunes.terms");
}

export async function itunesLookupIds(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>("window.__podnotesJourneyItunes.lookups");
}

export async function removeItunesStub(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson(`(() => {
		const stub = window.__podnotesJourneyItunes;
		if (stub) stub.ipc.send = stub.originalSend;
		delete window.__podnotesJourneyItunes;
		return true;
	})()`);
}

const DEEPGRAM_ORIGIN = "https://api.deepgram.com/";

export async function installDeepgramTripwire(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		if (window.__podnotesJourneyDeepgram) throw new Error("The Deepgram tripwire is already installed.");
		const ipc = window.electron.ipcRenderer;
		const originalSend = ipc.send;
		const requests = [];
		ipc.send = function (channel, replyChannel, request, ...rest) {
			if (channel === "request-url" && typeof request?.url === "string" && request.url.startsWith(${jsLiteral(DEEPGRAM_ORIGIN)})) {
				requests.push(request.url);
				queueMicrotask(() => ipc.emit(replyChannel, {}, { status: 500, headers: {}, body: new ArrayBuffer(0) }));
				return;
			}
			return originalSend.call(ipc, channel, replyChannel, request, ...rest);
		};
		window.__podnotesJourneyDeepgram = { ipc, originalSend, requests };
		return true;
	})()`);
}

export async function deepgramRequests(obsidian: ObsidianClient): Promise<string[]> {
	return await obsidian.dev.evalJson<string[]>("window.__podnotesJourneyDeepgram.requests");
}

export async function removeDeepgramTripwire(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson(`(() => {
		const tripwire = window.__podnotesJourneyDeepgram;
		if (tripwire) tripwire.ipc.send = tripwire.originalSend;
		delete window.__podnotesJourneyDeepgram;
		return true;
	})()`);
}

export type TranscriptionUpload = Readonly<{
	method: string;
	authorization: string | null;
	model: string | null;
	fileName: string | null;
	fileBytes: number;
	riffWave: boolean;
	sha256: string;
}>;

const OPENAI_TRANSCRIPTIONS_URL = "https://api.openai.com/v1/audio/transcriptions";

export async function installOpenAIStub(obsidian: ObsidianClient, text: string): Promise<void> {
	await obsidian.dev.evalJsonAsync(`(async () => {
		if (window.__podnotesJourneyOpenAI) throw new Error("The OpenAI stub is already installed.");
		const originalFetch = window.fetch;
		const uploads = [];
		window.fetch = async function (input, init) {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			if (url !== ${jsLiteral(OPENAI_TRANSCRIPTIONS_URL)}) return originalFetch.call(this, input, init);
			const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
			if (method !== "POST") throw new TypeError("The transcription upload must use POST.");
			const body = init?.body;
			const file = body instanceof FormData ? body.get("file") : null;
			const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array();
			const ascii = (from, to) => String.fromCharCode(...bytes.slice(from, to));
			uploads.push({
				method,
				authorization: new Headers(init?.headers).get("authorization"),
				model: body instanceof FormData ? body.get("model") : null,
				fileName: file instanceof File ? file.name : null,
				fileBytes: bytes.byteLength,
				riffWave: ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE",
				sha256: require("node:crypto").createHash("sha256").update(bytes).digest("hex"),
			});
			return new Response(JSON.stringify({ text: ${jsLiteral(text)} }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		window.__podnotesJourneyOpenAI = { originalFetch, uploads };
		return true;
	})()`);
}

export async function transcriptionUploads(
	obsidian: ObsidianClient,
): Promise<TranscriptionUpload[]> {
	return await obsidian.dev.evalJson<TranscriptionUpload[]>(
		"window.__podnotesJourneyOpenAI.uploads",
	);
}

export async function removeOpenAIStub(obsidian: ObsidianClient): Promise<void> {
	await obsidian.dev.evalJson(`(() => {
		const stub = window.__podnotesJourneyOpenAI;
		if (stub) window.fetch = stub.originalFetch;
		delete window.__podnotesJourneyOpenAI;
		return true;
	})()`);
}
