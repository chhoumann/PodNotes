#!/usr/bin/env node
// Trusted input for this worktree's Obsidian instance: real mouse and keyboard
// events sent through `obsidian dev:cdp`, aimed at an element found by CSS.
//
//   node .claude/skills/verify/ui.mjs click '<css>' [--text <substring>] [--right] [--timeout <ms>]
//   node .claude/skills/verify/ui.mjs type '<css>' '<text>'    click, then insert at the cursor
//   node .claude/skills/verify/ui.mjs fill '<css>' '<text>'    click, select all, then replace
//   node .claude/skills/verify/ui.mjs key <Enter|Escape|Tab|ArrowDown|ArrowUp|Backspace|Ctrl+<key>>
//   node .claude/skills/verify/ui.mjs wait '<css>' [--text <substring>] [--timeout <ms>]
//   node .claude/skills/verify/ui.mjs uri 'obsidian://podnotes?...'
//
// Every verb but `key` waits (default 10 s) until exactly one visible element
// matches the selector and --text filter, then acts on it.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const bridge = fileURLToPath(new URL("../../../scripts/obsidian-e2e.mjs", import.meta.url));
const KEYS = {
	Enter: [13, "\r"],
	Escape: [27],
	Tab: [9],
	Backspace: [8],
	ArrowDown: [40],
	ArrowUp: [38],
};

/** @param {string[]} args */
function obsidian(args) {
	return execFileSync(process.execPath, [bridge, "run", ...args], {
		cwd: root,
		encoding: "utf8",
	}).trim();
}

/** @param {string} method @param {object} params */
function cdp(method, params) {
	const output = obsidian(["dev:cdp", `method=${method}`, `params=${JSON.stringify(params)}`]);
	if (output.startsWith("Error")) throw new Error(`${method}: ${output}`);
}

/**
 * Center of the single visible element matching css and text, scrolled into view.
 * @param {string} css @param {string | undefined} text
 */
function locate(css, text) {
	const output = obsidian([
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

/**
 * Wait until exactly one visible element matches, so a click never lands on a
 * list that is still loading or on the wrong one of several matches.
 * @param {string} css @param {string | undefined} text
 */
async function find(css, text) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const found = locate(css, text);
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
	cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
	for (const type of ["mousePressed", "mouseReleased"]) {
		cdp("Input.dispatchMouseEvent", { type, x, y, button, clickCount: 1 });
	}
}

/** @param {string} combo */
function key(combo) {
	const parts = combo.split("+");
	const name = parts.pop() ?? "";
	const modifiers = parts.includes("Ctrl") ? 2 : 0;
	const [code, text] = KEYS[/** @type {keyof typeof KEYS} */ (name)] ?? [
		name.toUpperCase().charCodeAt(0),
		modifiers ? undefined : name,
	];
	const event = { key: name, windowsVirtualKeyCode: code, modifiers, ...(text ? { text } : {}) };
	cdp("Input.dispatchKeyEvent", { type: "keyDown", ...event });
	cdp("Input.dispatchKeyEvent", { type: "keyUp", ...event });
}

/**
 * Deliver an obsidian:// URI the way Obsidian's main process does once the OS
 * hands it over: parse it like Obsidian does and pass the result to OBS_ACT.
 * @param {string} uri
 */
function openUri(uri) {
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
	const output = obsidian(["eval", `code=window.OBS_ACT(${JSON.stringify(data)}), "delivered"`]);
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
		if (verb === "fill") key("Ctrl+a");
		cdp("Input.insertText", { text: rest[0] });
	} else if (verb === "key" && target) key(target);
	else if (verb === "wait" && target) await find(target, text);
	else if (verb === "uri" && target) openUri(target);
	else
		throw new Error(
			"Usage: ui.mjs click|type|fill|key|wait|uri ... (see the header of this file)",
		);
} catch (error) {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
}
