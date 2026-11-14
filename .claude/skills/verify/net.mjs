#!/usr/bin/env node
// Network log for this worktree's Obsidian instance, with a fixture provider in
// place of the paid transcription APIs.
//
//   node .claude/skills/verify/net.mjs watch     start a fresh log; answer ElevenLabs, Deepgram, OpenRouter
//                                                and OpenAI locally, OpenRouter's model catalog included
//   node .claude/skills/verify/net.mjs log       print each request as JSON, oldest first; a path only
//                                                for the fixture server and the four providers
//   node .claude/skills/verify/net.mjs unwatch   restore fetch and requestUrl
//
// PodNotes sends its requests (feeds, audio, transcripts, the providers)
// through requestUrl, which Obsidian forwards to its main process on the
// `request-url` IPC channel. The fetch log catches anything that bypasses it.
import { fileURLToPath } from "node:url";
import {
	cliSocketExists,
	execObsidian,
	loadRunnerConfig,
	obsidianCommandArgs,
	resolveInstanceOptions,
	resolveProvisionOptions,
} from "obsidian-e2e/runner";
import { FIXTURE_HOST } from "../../../scripts/e2e-instance.mjs";
import { jsLiteral } from "../../../scripts/js-literal.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const config = await loadRunnerConfig(root);
const instance = resolveInstanceOptions(
	resolveProvisionOptions({}, config, root),
	{},
	config,
	root,
);
const CALL_TIMEOUT_MS = 15000;
const FIXTURE_TRANSCRIPTION = "This text came from the fixture provider.";
const FIXTURE_REPLY = "A second speaker answers.";
const PATH_HOSTS = [
	FIXTURE_HOST,
	"api.elevenlabs.io",
	"api.deepgram.com",
	"openrouter.ai",
	"api.openai.com",
];
const OPENROUTER_TRANSCRIPTIONS = "https://openrouter.ai/api/v1/audio/transcriptions";
const OPENROUTER_CATALOG = "https://openrouter.ai/api/v1/models?";
const OPENROUTER_MODELS = [
	"x-ai/grok-stt-2.0",
	"elevenlabs/scribe-v2",
	"microsoft/mai-transcribe-2",
];

/** @param {string} code */
async function evaluate(code) {
	if (!(await cliSocketExists(instance))) {
		throw new Error(
			"This worktree's Obsidian instance is not running: npm run start:e2e-obsidian",
		);
	}
	const started = Date.now();
	const { stdout } = await execObsidian(
		instance,
		obsidianCommandArgs(instance.vaultName, ["eval", `code=${code}`]),
		{},
		{ timeout: CALL_TIMEOUT_MS },
	);
	// The CLI exits 0 with no output when the timeout kills it, so only the clock tells.
	if (Date.now() - started >= CALL_TIMEOUT_MS) {
		throw new Error(`obsidian eval did not answer within ${CALL_TIMEOUT_MS} ms.`);
	}
	const output = stdout.trim();
	if (!output.startsWith("=> ")) throw new Error(output);
	return output.slice(3);
}

const WATCH = `(() => {
	const previous = window.__podnotesVerifyNet;
	if (previous) {
		previous.entries.length = 0;
		return "reset";
	}
	const entries = [];
	// Other hosts log only their origin, because a private feed's path can hold its token.
	const pathHosts = new Set(${jsLiteral(PATH_HOSTS)});
	const logged = (url) => {
		try {
			const parsed = new URL(url);
			return pathHosts.has(parsed.hostname) ? parsed.origin + parsed.pathname : parsed.origin;
		} catch {
			return "(unparsable URL)";
		}
	};
	const text = ${jsLiteral(FIXTURE_TRANSCRIPTION)};
	// Deepgram's words: one every 0.4 s, the reply 12 s in from a second speaker.
	const words = (sentence, speaker, from) => sentence.split(" ").map((word, index) => ({
		word: word.toLowerCase().replace(/[^a-z]/g, ""),
		punctuated_word: word,
		start: from + index * 0.4,
		end: from + index * 0.4 + 0.3,
		speaker,
	}));
	const reply = ${jsLiteral(FIXTURE_REPLY)};
	const deepgram = { results: { channels: [{ alternatives: [{ words: [...words(text, 0, 0), ...words(reply, 1, 12)] }] }] } };
	// ElevenLabs' words, at the same times, with a spacing item between each two.
	const scribeWords = (sentence, speaker, from) => words(sentence, speaker, from).flatMap(({ punctuated_word, start, end }, index) => {
		const word = { text: punctuated_word, type: "word", start, end, speaker_id: "speaker_" + speaker };
		return index === 0 ? [word] : [{ text: " ", type: "spacing", start, end: start, speaker_id: word.speaker_id }, word];
	});
	const elevenlabs = { language_code: "eng", text: text + " " + reply, words: [...scribeWords(text, 0, 0), ...scribeWords(reply, 1, 12)] };
	// OpenRouter's verbose_json words, at the same times, with numbered speakers.
	const openRouterWords = (sentence, speaker, from) => words(sentence, speaker, from).map(({ punctuated_word, start, end }) => ({ word: punctuated_word, start, end, speaker, speaker_label: "speaker_" + speaker, confidence: 0.99 }));
	const openrouter = { text: text + " " + reply, words: [...openRouterWords(text, 0, 0), ...openRouterWords(reply, 1, 12)] };
	const openrouterCatalog = { data: ${jsLiteral(OPENROUTER_MODELS)}.map((id) => ({ id, expiration_date: null })) };
	// Grok's MP3 uploads are heard as a diarizing model hears them: a tone under 500 Hz is one
	// voice and a higher one another, labeled in the order they first sound in the request, with
	// a word for each turn. Other OpenRouter requests get the fixed answer.
	const hearOpenRouter = async (request, entry) => {
		if (request.contentType !== "application/json") return openrouter;
		const audio = JSON.parse(new TextDecoder().decode(request.body)).input_audio ?? {};
		if (audio.format !== "mp3" || !audio.data) return openrouter;
		const bytes = Uint8Array.from(atob(audio.data), (char) => char.charCodeAt(0));
		const decoded = await new OfflineAudioContext(1, 1, 8000).decodeAudioData(bytes.buffer);
		entry.decodedSeconds = Math.round(decoded.duration * 1000) / 1000;
		const samples = decoded.getChannelData(0);
		const step = decoded.sampleRate / 4;
		const labels = new Map();
		const words = [];
		let before;
		for (let at = 0; at + step <= samples.length; at += step) {
			let energy = 0;
			let crossings = 0;
			for (let index = at + 1; index < at + step; index++) {
				energy += samples[index] * samples[index];
				if (samples[index] >= 0 !== samples[index - 1] >= 0) crossings++;
			}
			// A tone of f Hz crosses zero 2f times a second, so f is twice the crossings in 0.25 s.
			const voice = energy / step < 0.001 ? undefined : crossings * 2 < 500 ? "Low" : "High";
			const [start, end] = [at / decoded.sampleRate, (at + step) / decoded.sampleRate];
			if (voice && voice === before) words[words.length - 1].end = end;
			else if (voice) {
				if (!labels.has(voice)) labels.set(voice, labels.size);
				const speaker = labels.get(voice);
				words.push({ word: voice + " voice.", start, end, speaker, speaker_label: "speaker_" + speaker, confidence: 0.99 });
			}
			before = voice;
		}
		entry.heardSpeakers = labels.size;
		return { text: words.map(({ word }) => word).join(" "), words };
	};
	// A request that names an address in place of a file is a few hundred bytes: multipart
	// with source_url for ElevenLabs, JSON with input_audio.url for OpenRouter.
	const namedAddress = (request) => {
		if (!(request.body?.byteLength < 4096)) return undefined;
		const body = new TextDecoder().decode(request.body);
		const match = /name="source_url"\\r\\n\\r\\n([^\\r]+)/.exec(body) ?? /"input_audio":\\{"url":"([^"]+)"/.exec(body);
		return match ? logged(match[1]) : undefined;
	};
	const originalFetch = window.fetch;
	window.fetch = async function (input, init) {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
		entries.push({ via: "fetch", method, url: logged(url) });
		return originalFetch.call(this, input, init);
	};
	const ipc = window.electron.ipcRenderer;
	const originalSend = ipc.send;
	ipc.send = function (channel, replyChannel, request, ...rest) {
		if (channel === "request-url" && typeof request?.url === "string") {
			const method = (request.method ?? "GET").toUpperCase();
			const entry = { via: "requestUrl", method, url: logged(request.url) };
			const answer = request.url.startsWith("https://api.openai.com/")
				? { text }
				: request.url.startsWith("https://api.deepgram.com/")
					? deepgram
					: request.url.startsWith("https://api.elevenlabs.io/")
						? elevenlabs
						: request.url === ${jsLiteral(OPENROUTER_TRANSCRIPTIONS)}
							? hearOpenRouter(request, entry)
							: request.url.startsWith(${jsLiteral(OPENROUTER_CATALOG)})
								? openrouterCatalog
								: null;
			if (answer) {
				entries.push(Object.assign(entry, { answeredBy: "fixture provider", contentType: request.contentType, uploadBytes: request.body?.byteLength ?? 0, sourceUrl: namedAddress(request) }));
				// Audio the decoder refuses is answered as OpenRouter answers audio it cannot read.
				Promise.resolve(answer)
					.then((json) => ({ status: 200, json }), () => {
						entry.decodedSeconds = "undecodable";
						return { status: 400, json: { error: { message: "Invalid audio file", code: 400 } } };
					})
					.then(({ status, json }) => ipc.emit(replyChannel, {}, { status, headers: { "content-type": "application/json" }, body: new TextEncoder().encode(JSON.stringify(json)).buffer }));
				return;
			}
			entries.push(entry);
		}
		return originalSend.call(ipc, channel, replyChannel, request, ...rest);
	};
	window.__podnotesVerifyNet = { entries, restore: () => { window.fetch = originalFetch; ipc.send = originalSend; } };
	return "watching";
})()`;

const LOG = `JSON.stringify(window.__podnotesVerifyNet?.entries ?? null)`;

const UNWATCH = `(() => {
	window.__podnotesVerifyNet?.restore();
	delete window.__podnotesVerifyNet;
	return "restored";
})()`;

const [verb] = process.argv.slice(2);
try {
	if (verb === "watch") console.log(await evaluate(WATCH));
	else if (verb === "log") {
		const entries = JSON.parse(await evaluate(LOG));
		if (entries === null) throw new Error("Not watching: run net.mjs watch first.");
		for (const entry of entries) console.log(JSON.stringify(entry));
	} else if (verb === "unwatch") console.log(await evaluate(UNWATCH));
	else throw new Error("Usage: net.mjs watch | log | unwatch");
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
