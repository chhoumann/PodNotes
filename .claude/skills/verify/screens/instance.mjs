import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	cliSocketExists,
	execObsidian,
	loadRunnerConfig,
	obsidianCommandArgs,
	resolveInstanceOptions,
	resolveProvisionOptions,
} from "obsidian-e2e/runner";
import { pngSize } from "./sheet.mjs";
import { jsLiteral } from "../../../../scripts/js-literal.mjs";

/** @typedef {import("./scenes.mjs").Page} Page */

export const root = fileURLToPath(new URL("../../../..", import.meta.url));
export const config = await loadRunnerConfig(root);
export const provision = resolveProvisionOptions({}, config, root);
const instance = resolveInstanceOptions(provision, {}, config, root);
export const UI = fileURLToPath(new URL("../ui.mjs", import.meta.url));
export const FIXTURES = fileURLToPath(new URL("../fixtures.mjs", import.meta.url));
const VIEW_TYPE = "podcast_player_view";
const CALL_TIMEOUT_MS = 15000;
/** @type {Record<string, [number, number]>} */
export const WIDTHS = { sidebar: [320, 720], pane: [820, 680], phone: [390, 844] };
/** @type {Record<string, string>} */
export const THEMES = { light: "moonstone", dark: "obsidian" };
const CURRENT_THEME = `(document.body.classList.contains("theme-dark") ? "dark" : "light")`;

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

/** @param {string} body */
export async function evaluate(body) {
	const output = await obsidian([
		"eval",
		`code=(async () => JSON.stringify((await (async () => {${body}})()) ?? null))()`,
	]);
	if (!output.startsWith("=> ")) throw new Error(output || "eval printed nothing");
	return JSON.parse(output.slice(3));
}

/** @param {string} method @param {object} [params] */
async function cdp(method, params = {}) {
	const output = await obsidian([
		"dev:cdp",
		`method=${method}`,
		`params=${JSON.stringify(params)}`,
	]);
	if (!output.startsWith("{")) throw new Error(`${method}: ${output}`);
	return JSON.parse(output);
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Errors count as false, because the window reloads under some of these waits.
 * @param {string} body @param {string} what @param {number} [timeoutMs]
 */
export async function waitFor(body, what, timeoutMs = 30000) {
	const deadline = Date.now() + timeoutMs;
	let last = "";
	for (;;) {
		try {
			if ((await evaluate(body)) === true) return;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}
		if (Date.now() > deadline) throw new Error(`${what} after ${timeoutMs} ms. ${last}`);
		await sleep(250);
	}
}

/** @param {boolean} on */
async function setMobile(on) {
	const { mobile, origin } = await evaluate(
		"return { mobile: app.isMobile, origin: performance.timeOrigin };",
	);
	if (mobile === on) return;
	await evaluate(`setTimeout(() => app.emulateMobile(${on}), 50); return true;`);
	await waitFor(
		`return performance.timeOrigin !== ${origin} && app.isMobile === ${on} &&
			app.workspace.layoutReady && Boolean(app.plugins.plugins.podnotes);`,
		`Obsidian did not reload ${on ? "into" : "out of"} mobile emulation`,
	);
}

/** @param {string} name */
export async function place(name) {
	if (!(name in WIDTHS)) throw new Error("Usage: place <sidebar|pane|phone>");
	const [width, height] = WIDTHS[name];
	const sidebar = name === "sidebar";
	const phone = name === "phone";
	if (phone) {
		await cdp("Emulation.setDeviceMetricsOverride", {
			width,
			height,
			deviceScaleFactor: 1,
			mobile: true,
			screenWidth: width,
			screenHeight: height,
		});
	} else {
		await cdp("Emulation.clearDeviceMetricsOverride");
	}
	await setMobile(phone);
	await evaluate(`
		const { workspace } = app;
		const inSidebar = (leaf) => leaf.getRoot() === workspace.rightSplit;
		for (const leaf of workspace.getLeavesOfType("${VIEW_TYPE}")) {
			if (inSidebar(leaf) !== ${sidebar}) leaf.detach();
		}
		if (workspace.getLeavesOfType("${VIEW_TYPE}").length === 0) {
			// Not getLeaf(false): it can return the leaf just detached when that leaf had focus.
			let leaf = ${sidebar} ? workspace.getRightLeaf(false) : undefined;
			workspace.iterateRootLeaves((candidate) => {
				if (!${sidebar} && (!leaf || candidate.view.getViewType() === "empty")) leaf = candidate;
			});
			await leaf.setViewState({ type: "${VIEW_TYPE}" });
		}
		// Show player's path: it reveals the leaf, and on mobile mounts the view.
		await app.plugins.plugins.podnotes.activateView();
		workspace.leftSplit.collapse();
		if (!${sidebar}) workspace.rightSplit.collapse();
		return true;
	`);
	const measure = async () => {
		await waitFor(
			`return document.querySelector(".podcast-view")?.getBoundingClientRect().width > 0;`,
			"The PodNotes view did not appear",
			10000,
		);
		return evaluate(`
			await new Promise((resolve) => setTimeout(resolve, 300));
			const rect = document.querySelector(".podcast-view").getBoundingClientRect();
			return { width: rect.width, height: ${phone} ? innerHeight : rect.height,
				phone: document.body.classList.contains("is-phone") };
		`);
	};
	// Obsidian's chrome can leave the view a fraction of a pixel taller; a capture rounds it.
	const fits = (/** @type {{ width: number, height: number }} */ view) =>
		view.width === width && Math.round(view.height) === height;
	let measured = await measure();
	for (let attempt = 0; !phone && attempt < 3; attempt++) {
		if (fits(measured)) break;
		await evaluate(`
			const win = require("electron").remote.getCurrentWindow();
			if (win.isFullScreen()) win.setFullScreen(false);
			if (win.isMaximized()) win.unmaximize();
			const [contentWidth, contentHeight] = win.getContentSize();
			const dw = ${width} - ${measured.width};
			const dh = ${height} - ${measured.height};
			if (${sidebar}) app.workspace.rightSplit.setSize(app.workspace.rightSplit.size + dw);
			win.setContentSize(
				${sidebar} ? Math.max(contentWidth, 1024) : Math.round(contentWidth + dw),
				Math.round(contentHeight + dh),
			);
			return true;
		`);
		measured = await measure();
	}
	const problems = [
		measured.width !== width && `the view is ${measured.width} px wide, not ${width}`,
		Math.round(measured.height) !== height &&
			`${phone ? "the screen" : "the view"} is ${measured.height} px tall, not ${height}`,
		phone !== measured.phone && `body.is-phone is ${measured.phone}`,
	].filter(Boolean);
	if (problems.length > 0) throw new Error(`place ${name}: ${problems.join("; ")}.`);
	console.log(JSON.stringify({ place: name, width: measured.width, height: measured.height }));
}

/** @param {string} name */
export async function theme(name) {
	if (!(name in THEMES)) throw new Error("Usage: theme <light|dark>");
	await evaluate(`app.changeTheme("${THEMES[name]}"); return true;`);
	await waitFor(
		`return document.body.classList.contains("theme-${name}");`,
		`The ${name} theme did not apply`,
		5000,
	);
}

/** @param {Page} page */
export async function go(page) {
	await evaluate(`
		const plugin = app.plugins.plugins.podnotes;
		plugin.navigation.replace(${jsLiteral(page)});
		await plugin.activateView();
		return true;
	`);
}

const PLAYER_STATE = `let state;
	app.plugins.plugins.podnotes.player.state.subscribe((value) => (state = value))();`;

/**
 * Plays the episode the scene restored and pauses it at `at` seconds once its media has
 * loaded, saved there so lists show the same progress every time. "error" waits for the
 * load to fail instead.
 * @param {number | "error"} at
 */
export async function playback(at) {
	await evaluate(
		`${PLAYER_STATE} app.plugins.plugins.podnotes.player.play(state.episode); return true;`,
	);
	if (at === "error") {
		await waitFor(
			`${PLAYER_STATE} return state.status === "error";`,
			"The episode's media did not fail to load",
		);
		return;
	}
	await waitFor(
		`${PLAYER_STATE} return state.status === "playing";`,
		"The episode's media did not load and play",
	);
	await evaluate(`
		const { player } = app.plugins.plugins.podnotes;
		player.pause();
		player.seek(${at});
		return true;
	`);
	await waitFor(
		`const media = document.querySelector(".podnotes-media");
		return media.paused && !media.seeking && media.readyState >= 2 && media.currentTime === ${at};`,
		`The episode did not pause at ${at} s`,
	);
	await evaluate("app.plugins.plugins.podnotes.player.save(); return true;");
}

/** Captures once without the UI, so the episode note exists, as after an earlier capture. */
export async function episodeNote() {
	const capture = await evaluate(`
		// The last note open in an editor would take the capture.
		app.workspace.detachLeavesOfType("markdown");
		return await app.plugins.plugins.podnotes.capture.timestamp();
	`);
	if (capture?.destination !== "note") {
		throw new Error(`The capture went to ${JSON.stringify(capture)}, not the episode note.`);
	}
}

/**
 * Presses the full player's button that reads `text`, with real input. A panel switch or
 * tab that is already on stays on. Fails at once without such a button.
 * @param {string} text
 */
export async function press(text) {
	const button = `[...document.querySelectorAll("section.pn-player button")].find((button) =>
		button.getBoundingClientRect().width > 0 && button.innerText.trim() === ${jsLiteral(text)})`;
	// "true" or "false" for a panel switch or tab.
	const state = `((button) => !button ? "missing" :
		button.getAttribute("aria-pressed") ?? button.getAttribute("aria-selected") ?? "action")(${button})`;
	const kind = await evaluate(`return ${state};`);
	if (kind === "missing") {
		throw new Error(`No button in the full player (section.pn-player) reads "${text}".`);
	}
	if (kind === "true") return;
	execFileSync(
		process.execPath,
		[UI, "click", "section.pn-player button", "--text", text, "--exact"],
		{ stdio: "inherit" },
	);
	if (kind === "false") {
		await waitFor(`return ${state} === "true";`, `"${text}" did not turn on`, 5000);
		return;
	}
	// Timestamp reads "Added" for 1.2 s after a capture.
	await sleep(1500);
	await waitFor(`return Boolean(${button});`, `"${text}" did not come back`, 5000);
}

/** @param {boolean} on */
export async function offline(on) {
	execFileSync(process.execPath, [FIXTURES, on ? "stop" : "library"]);
	const event = on ? "offline" : "online";
	await evaluate(`
		window.__podnotesVerifyNetwork = navigator.onLine === ${on}
			? new Promise((resolve) => addEventListener("${event}", () => resolve("fired"), { once: true }))
			: Promise.resolve("was already ${event}");
		return true;
	`);
	await cdp("Network.emulateNetworkConditions", {
		offline: on,
		latency: 0,
		downloadThroughput: -1,
		uploadThroughput: -1,
	});
	const state = await evaluate(`
		const event = await Promise.race([
			window.__podnotesVerifyNetwork,
			new Promise((resolve) => setTimeout(() => resolve("did not fire"), 2000)),
		]);
		// The first saved feed, sent the way requestUrl sends PodNotes' feed requests.
		const url = Object.values(app.plugins.plugins.podnotes.settings.savedFeeds)[0]?.url;
		const ipc = window.electron.ipcRenderer;
		const reply = "podnotes-verify-" + Math.random();
		const feed = url === undefined ? "no saved feed" : await new Promise((resolve) => {
			ipc.once(reply, (_event, response) => resolve(response.error ? "failed" : response.status));
			ipc.send("request-url", reply, { url, method: "GET" });
			setTimeout(() => resolve("no answer"), 5000);
		});
		return { onLine: navigator.onLine, ${event}: event, feed };
	`);
	console.log(JSON.stringify(state));
	const feedAsExpected =
		state.feed === "no saved feed" || (typeof state.feed === "number") !== on;
	if (state.onLine === on || state[event] === "did not fire" || !feedAsExpected) {
		throw new Error(`offline ${on ? "on" : "off"} did not take: ${JSON.stringify(state)}`);
	}
}

const STATUS_ITEM = "podnotes-verify-status-item";

/** Adds or removes an item in Obsidian's status bar, as a plugin's addStatusBarItem does. @param {boolean} on */
export async function statusItem(on) {
	await evaluate(`
		document.querySelector(".${STATUS_ITEM}")?.remove();
		if (${on}) document.querySelector(".status-bar").createDiv({ cls: "status-bar-item ${STATUS_ITEM}", text: "9 properties" });
		return true;
	`);
}

/** @param {string} [text] */
async function settle(text = "") {
	const deadline = Date.now() + 20000;
	let previous = "";
	let stable = 0;
	for (;;) {
		const state = await evaluate(`
			const view = document.querySelector(".podcast-view");
			if (!view) return { why: "no .podcast-view" };
			const box = view.getBoundingClientRect();
			const loading = [...view.querySelectorAll("img")].filter((img) => {
				const rect = img.getBoundingClientRect();
				const visible = rect.bottom > box.top && rect.top < box.bottom && rect.width > 0;
				return visible && !img.complete;
			}).length;
			const moving = document.getAnimations().filter(
				(animation) => animation.playState === "running" && view.contains(animation.effect?.target),
			).length;
			const shown = view.innerText.includes(${jsLiteral(text)});
			return { loading, moving, shown, markup: view.innerHTML.length };
		`);
		const ready = state.loading === 0 && state.moving === 0 && state.shown;
		const markup = String(state.markup);
		stable = ready && markup === previous ? stable + 1 : 0;
		previous = markup;
		if (stable >= 3) return;
		if (Date.now() > deadline) {
			throw new Error(`The view did not settle within 20 s: ${JSON.stringify(state)}`);
		}
		await sleep(250);
	}
}

/**
 * `statusBar` keeps Obsidian's status bar in the capture, which then fails unless the
 * whole bar lies inside it. `notice` keeps Obsidian's notices, and fails unless one says it.
 * @param {string} file @param {string} [text] @param {string} [themeName] @param {boolean} [statusBar] @param {string} [notice]
 */
export async function shot(file, text, themeName, statusBar = false, notice = "") {
	await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: -10, y: -10 });
	await evaluate(`
		document.activeElement?.blur?.();
		document.querySelectorAll(".tooltip").forEach((tooltip) => tooltip.remove());
		return true;
	`);
	await settle(text);
	const target = await evaluate(`
		document.querySelectorAll(".tooltip").forEach((tooltip) => tooltip.remove());
		const notices = [...document.querySelectorAll(".notice")].map((notice) => {
			const said = notice.innerText.trim();
			if (!${jsLiteral(notice)}) notice.remove();
			return said;
		});
		// Obsidian's status bar floats over the view's bottom-right corner.
		const bar = document.querySelector(".status-bar");
		if (!${statusBar}) bar?.style.setProperty("visibility", "hidden");
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
		const rect = document.body.classList.contains("is-phone")
			? { x: 0, y: 0, width: innerWidth, height: innerHeight }
			: document.querySelector(".podcast-view").getBoundingClientRect().toJSON();
		return { notices, rect, bar: bar?.getBoundingClientRect().toJSON(), scale: devicePixelRatio, theme: ${CURRENT_THEME} };
	`);
	if (notice && !target.notices.some((/** @type {string} */ said) => said.includes(notice))) {
		throw new Error(`No notice says "${notice}": ${JSON.stringify(target.notices)}`);
	}
	// Whole pixels, so the capture is not resampled.
	const [x, y, width, height] = ["x", "y", "width", "height"].map((key) =>
		Math.round(target.rect[key]),
	);
	const bar = target.bar;
	if (
		statusBar &&
		!(
			bar?.width > 0 &&
			Math.round(bar.left) >= x &&
			Math.round(bar.right) <= x + width &&
			Math.round(bar.top) >= y &&
			Math.round(bar.bottom) <= y + height
		)
	) {
		throw new Error(`Obsidian's status bar ${JSON.stringify(bar)} is not inside the view.`);
	}
	const { data } = await cdp("Page.captureScreenshot", {
		format: "png",
		clip: { x, y, width, height, scale: 1 },
	});
	const after = await evaluate(
		`document.querySelector(".status-bar")?.style.removeProperty("visibility"); return ${CURRENT_THEME};`,
	);
	// The file name promises a theme, and a window reload can still be applying the saved one.
	if (themeName && (target.theme !== themeName || after !== themeName)) {
		throw new Error(
			`The theme turned ${target.theme === themeName ? after : target.theme} around the capture of ${path.relative(root, path.resolve(file))}, not ${themeName}. Run it again.`,
		);
	}
	const png = Buffer.from(data, "base64");
	const size = pngSize(png);
	if (size.width !== width * target.scale || size.height !== height * target.scale) {
		throw new Error(
			`The capture is ${size.width} x ${size.height}, not the ${width} x ${height} view.`,
		);
	}
	fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
	fs.writeFileSync(file, png);
	console.log(
		JSON.stringify({
			file: path.relative(root, path.resolve(file)),
			...size,
			notices: target.notices,
		}),
	);
}
