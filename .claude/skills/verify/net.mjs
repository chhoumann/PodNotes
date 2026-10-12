#!/usr/bin/env node
// Network log for this worktree's Obsidian instance, with a fixture provider in
// place of the paid transcription APIs.
//
//   node .claude/skills/verify/net.mjs watch     start a fresh log; answer OpenAI and Deepgram locally
//   node .claude/skills/verify/net.mjs log       print each request as JSON, oldest first; a path only
//                                                for the fixture server, OpenAI and Deepgram
//   node .claude/skills/verify/net.mjs unwatch   restore fetch and requestUrl
//
// PodNotes sends OpenAI uploads through window.fetch and everything else
// (feeds, audio, transcripts, Deepgram) through requestUrl, which Obsidian
// forwards to its main process on the `request-url` IPC channel.
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
const PATH_HOSTS = [FIXTURE_HOST, "api.openai.com", "api.deepgram.com"];

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
	const pathHosts = new Set(${JSON.stringify(PATH_HOSTS)});
	const logged = (url) => {
		try {
			const parsed = new URL(url);
			return pathHosts.has(parsed.hostname) ? parsed.origin + parsed.pathname : parsed.origin;
		} catch {
			return "(unparsable URL)";
		}
	};
	const text = ${JSON.stringify(FIXTURE_TRANSCRIPTION)};
	const originalFetch = window.fetch;
	window.fetch = async function (input, init) {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
		if (url.startsWith("https://api.openai.com/")) {
			const file = init?.body instanceof FormData ? init.body.get("file") : null;
			entries.push({ via: "fetch", method, url: logged(url), answeredBy: "fixture provider", uploadBytes: file instanceof Blob ? file.size : 0 });
			return new Response(JSON.stringify({ text, segments: [{ speaker: "A", text, start: 0, end: 1 }] }), { status: 200, headers: { "content-type": "application/json" } });
		}
		entries.push({ via: "fetch", method, url: logged(url) });
		return originalFetch.call(this, input, init);
	};
	const ipc = window.electron.ipcRenderer;
	const originalSend = ipc.send;
	ipc.send = function (channel, replyChannel, request, ...rest) {
		if (channel === "request-url" && typeof request?.url === "string") {
			const method = (request.method ?? "GET").toUpperCase();
			if (request.url.startsWith("https://api.deepgram.com/")) {
				entries.push({ via: "requestUrl", method, url: logged(request.url), answeredBy: "fixture provider", uploadBytes: request.body?.byteLength ?? 0 });
				const body = new TextEncoder().encode(JSON.stringify({ results: { utterances: [{ speaker: 0, transcript: text, start: 0, end: 1 }] } })).buffer;
				queueMicrotask(() => ipc.emit(replyChannel, {}, { status: 200, headers: { "content-type": "application/json" }, body }));
				return;
			}
			entries.push({ via: "requestUrl", method, url: logged(request.url) });
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
