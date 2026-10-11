#!/usr/bin/env node
// Trusted input for this worktree's Obsidian instance: real mouse and keyboard
// events sent through `obsidian dev:cdp`, aimed at an element found by CSS.
//
//   node .claude/skills/verify/ui.mjs click '<css>' [--text <substring>] [--right] [--timeout <ms>]
//   node .claude/skills/verify/ui.mjs type '<css>' '<text>'    click, then insert at the cursor
//   node .claude/skills/verify/ui.mjs fill '<css>' '<text>'    click, select all, then replace
//   node .claude/skills/verify/ui.mjs key <Enter|Escape|Tab|ArrowDown|ArrowUp|Backspace|<char>|Ctrl+<char>>
//   node .claude/skills/verify/ui.mjs wait '<css>' [--text <substring>] [--timeout <ms>]
//   node .claude/skills/verify/ui.mjs uri 'obsidian://podnotes?...'
//
// `click`, `type`, `fill` and `wait` wait up to 10 s until exactly one visible
// element matches the selector and --text filter, so they never act on a list
// still loading or on the wrong match. `key` and `uri` do not wait.
import { fileURLToPath } from "node:url";
import {
	cliSocketExists,
	execObsidian,
	loadRunnerConfig,
	obsidianCommandArgs,
	resolveInstanceOptions,
	resolveProvisionOptions,
} from "obsidian-e2e/runner";

const root = fileURLToPath(new URL("../../..", import.meta.url));
// Linux Obsidian's CLI socket follows $XDG_RUNTIME_DIR when it is set; this
// instance's socket is in its private HOME (see scripts/obsidian-e2e.mjs).
if (process.platform === "linux") delete process.env.XDG_RUNTIME_DIR;
const config = await loadRunnerConfig(root);
const instance = resolveInstanceOptions(
	resolveProvisionOptions({}, config, root),
	{},
	config,
	root,
);
const CALL_TIMEOUT_MS = 15000;
/** @type {Map<string, [number, string?]>} */
const KEYS = new Map([
	["Enter", [13, "\r"]],
	["Escape", [27]],
	["Tab", [9]],
	["Backspace", [8]],
	["ArrowDown", [40]],
	["ArrowUp", [38]],
]);

/** @param {string[]} args */
async function obsidian(args) {
	if (!(await cliSocketExists(instance))) {
		throw new Error(
			"This worktree's Obsidian instance is not running: npm run start:e2e-obsidian",
		);
	}
	const started = Date.now();
	const { stdout } = await execObsidian(
		instance,
		obsidianCommandArgs(instance.vaultName, args),
		{},
		{ timeout: CALL_TIMEOUT_MS },
	);
	// The CLI exits 0 with no output when the timeout kills it, so only the clock tells.
	if (Date.now() - started >= CALL_TIMEOUT_MS) {
		throw new Error(`obsidian ${args[0]} did not answer within ${CALL_TIMEOUT_MS} ms.`);
	}
	return stdout.trim();
}

/** @param {string} method @param {object} params */
async function cdp(method, params) {
	const output = await obsidian([
		"dev:cdp",
		`method=${method}`,
		`params=${JSON.stringify(params)}`,
	]);
	if (output.startsWith("Error")) throw new Error(`${method}: ${output}`);
}

/** @param {string} css @param {string | undefined} text */
async function locate(css, text) {
	const output = await obsidian([
		"eval",
		`code=(() => {
			const matches = [...document.querySelectorAll(${JSON.stringify(css)})].filter((el) => {
				const rect = el.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 && (${JSON.stringify(text ?? "")} === "" || el.textContent.includes(${JSON.stringify(text ?? "")}));
			});
			if (matches.length !== 1) return JSON.stringify({ count: matches.length });
			matches[0].scrollIntoView({ block: "center", inline: "center" });
			const rect = matches[0].getBoundingClientRect();
			return JSON.stringify({ count: 1, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
		})()`,
	]);
	if (!output.startsWith("=> ")) throw new Error(output);
	return JSON.parse(output.slice(3));
}

/** @param {string} css @param {string | undefined} text */
async function find(css, text) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = await locate(css, text);
		if (found.count === 1) return found;
		if (Date.now() > deadline) {
			throw new Error(
				`${found.count} visible elements match ${css}${text ? ` with text "${text}"` : ""} after ${timeoutMs} ms; need exactly 1.`,
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
}

/** @param {string} css @param {string | undefined} text @param {"left" | "right"} button */
async function click(css, text, button) {
	const { x, y } = await find(css, text);
	await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	for (const type of ["mousePressed", "mouseReleased"]) {
		await cdp("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
	}
}

/** @param {string} combo */
async function key(combo) {
	const parts = combo.split("+");
	const name = parts.pop() ?? "";
	if (parts.some((part) => part !== "Ctrl")) {
		throw new Error(`Unsupported modifier in ${combo}; only Ctrl is supported.`);
	}
	if (!KEYS.has(name) && name.length !== 1) {
		throw new Error(
			`Unknown key ${name}; use a single character or ${[...KEYS.keys()].join(", ")}.`,
		);
	}
	const modifiers = parts.length > 0 ? 2 : 0;
	const [code, text] = KEYS.get(name) ?? [
		name.toUpperCase().charCodeAt(0),
		modifiers ? undefined : name,
	];
	const event = { key: name, windowsVirtualKeyCode: code, modifiers, ...(text ? { text } : {}) };
	await cdp("Input.dispatchKeyEvent", { type: "keyDown", ...event });
	await cdp("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

/**
 * Deliver an obsidian:// URI the way Obsidian's main process does once the OS
 * hands it over: parse it like Obsidian does and pass the result to OBS_ACT.
 * @param {string} uri
 */
async function openUri(uri) {
	if (!uri.startsWith("obsidian://")) throw new Error(`Not an obsidian:// URI: ${uri}`);
	let rest = uri.slice("obsidian://".length);
	/** @type {Record<string, string>} */
	const data = {};
	const hash = rest.indexOf("#", Math.max(0, rest.indexOf("?")));
	if (hash >= 0) {
		data.hash = rest.slice(hash + 1);
		rest = rest.slice(0, hash);
	}
	const [action = "", query = ""] = rest.split(/\?(.*)/s);
	for (const pair of query.split("&")) {
		const split = pair.indexOf("=");
		const name = split === -1 ? pair : pair.slice(0, split);
		if (name)
			data[decodeURIComponent(name)] =
				split === -1 ? "true" : decodeURIComponent(pair.slice(split + 1));
	}
	data.action = action.replace(/\/+$/, "");
	const output = await obsidian([
		"eval",
		`code=window.OBS_ACT(${JSON.stringify(data)}), "delivered"`,
	]);
	if (!output.endsWith("=> delivered")) throw new Error(output);
}

/** @param {string[]} args @param {string} name */
function flag(args, name) {
	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}

const [verb, target, ...rest] = process.argv.slice(2);
const text = flag(rest, "--text");
const timeoutMs = Number(flag(rest, "--timeout") ?? 10000);
try {
	if (verb === "click" && target)
		await click(target, text, rest.includes("--right") ? "right" : "left");
	else if ((verb === "type" || verb === "fill") && target && rest[0] !== undefined) {
		await click(target, undefined, "left");
		if (verb === "fill") await key("Ctrl+a");
		await cdp("Input.insertText", { text: rest[0] });
	} else if (verb === "key" && target) await key(target);
	else if (verb === "wait" && target) await find(target, text);
	else if (verb === "uri" && target) await openUri(target);
	else
		throw new Error(
			"Usage: ui.mjs click|type|fill|key|wait|uri ... (see the header of this file)",
		);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
