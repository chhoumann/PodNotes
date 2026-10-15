// Records the docs' guide clips in this worktree's isolated Obsidian, so they can
// be recorded again after any UI change. Run from the repo root:
//
//   npm run build && npm run start:e2e-obsidian
//   node docs/scripts/videos.mjs [clip ...]
//
// Each clip drives PodNotes with real mouse or touch input through the instance's
// DevTools port. The recording shows no system pointer, so the page draws one.
// Only the network is staged: Apple Podcasts search answers with the fixture
// library, and the private feed's made-up address loads a fixture feed. The script
// records the window at 2x, crops it to the clip's frame, and writes `<name>.mp4`
// and a `<name>.webp` poster, plus `-dark` twins, to docs/public/videos. It drives
// the instance with the verify skill's screens tooling, like screenshots.mjs, and
// leaves the vault with an empty library.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { connectCapture, typeText, withRecording } from "obsidian-e2e/capture";
import sharp from "sharp";
import { FIXTURE_HOST } from "../../scripts/e2e-instance.mjs";
import {
	evaluate,
	go,
	place,
	playback,
	root,
	theme,
	waitFor,
} from "../../.claude/skills/verify/screens/instance.mjs";
import { library, seed } from "../../.claude/skills/verify/screens/scenes.mjs";
import { API, cdp, docsLibrary, episode, instance, plan, writeNote } from "./scene.mjs";

const outDir = fileURLToPath(new URL("../public/videos", import.meta.url));
const work = path.join(root, ".obsidian-e2e-artifacts", "docs-videos");
const FPS = 30;
// Linux draws scrollbars that macOS hides until you scroll, and window buttons
// that belong to the operating system, not to Obsidian.
const CAPTURE_CSS =
	"::-webkit-scrollbar, .titlebar-button-container, .status-bar { display: none; }";
// Obviously made up, in the Supercast form that PodNotes keeps private.
const PRIVATE_ADDRESS = "https://example.supercast.com/feed/abc123.rss";
const PRIVATE_PODCAST = "Slow Thinking";

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */
/** @typedef {{ x: number, y: number }} Point */
/** @typedef {Awaited<ReturnType<typeof library>>} Library */

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Renders the current layout at `factor`x on a window `factor` times its size,
 * through Electron's zoom. Screencast frames ignore an emulated pixel ratio, so
 * the screens tooling's device metrics would record at 1x.
 * @param {number} factor
 */
async function zoom(factor) {
	const { width, height } = await evaluate(`return { width: innerWidth, height: innerHeight };`);
	await cdp("Emulation.clearDeviceMetricsOverride");
	await evaluate(`
		const win = require("electron").remote.getCurrentWindow();
		// Electron skips a resize to the size it believes the window has.
		win.setContentSize(${width * factor + 2}, ${height * factor + 2});
		await new Promise((resolve) => setTimeout(resolve, 300));
		win.setContentSize(${width * factor}, ${height * factor});
		require("electron").webFrame.setZoomFactor(${factor});
		return true;
	`);
	await waitFor(
		`return devicePixelRatio === ${factor} && innerWidth === ${width} && innerHeight === ${height};`,
		`The window did not render ${width} x ${height} at ${factor}x`,
		5000,
	);
}

// A drawn pointer that follows the real pointer events: an arrow for the mouse, a
// dot for a finger, and a ring where each press lands.
const POINTER = `(() => {
	document.getElementById("docs-pointer")?.remove();
	const layer = document.createElement("div");
	layer.id = "docs-pointer";
	layer.innerHTML = '<svg class="arrow" width="24" height="24" viewBox="0 0 24 24"><path d="M3 2 L3 19 L7.5 14.8 L10.6 21.6 L13.6 20.3 L10.6 13.6 L16.6 13.6 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg><div class="finger"></div>';
	document.body.append(layer);
	const arrow = layer.querySelector(".arrow");
	const finger = layer.querySelector(".finger");
	const put = (el, { clientX, clientY }) => (el.style.translate = clientX + "px " + clientY + "px");
	addEventListener("pointermove", (event) => {
		if (event.pointerType !== "touch") arrow.classList.add("is-on");
		put(event.pointerType === "touch" ? finger : arrow, event);
	}, true);
	addEventListener("pointerdown", (event) => {
		if (event.pointerType === "touch") {
			put(finger, event);
			finger.classList.add("is-down");
		} else arrow.classList.add("is-down");
		const ring = layer.appendChild(document.createElement("div"));
		ring.className = "ring";
		put(ring, event);
		ring.animate([{ scale: 0.3, opacity: 0.9 }, { scale: 1.6, opacity: 0 }], { duration: 500, easing: "ease-out" })
			.finished.then(() => ring.remove());
	}, true);
	for (const type of ["pointerup", "pointercancel"]) {
		addEventListener(type, () => {
			finger.classList.remove("is-down");
			arrow.classList.remove("is-down");
		}, true);
	}
	return true;
})()`;
// The screencast sends a frame only when the page paints, and obsidian-e2e holds
// the last frame of a still ending twice as long, so a pixel keeps changing.
const POINTER_CSS = `
#docs-pointer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
#docs-pointer::before { content: ""; position: absolute; width: 1px; height: 1px; background: #808080;
	animation: docs-tick 0.1s steps(2) infinite; }
@keyframes docs-tick { from { opacity: 0.01; } to { opacity: 0.02; } }
#docs-pointer > * { position: absolute; left: 0; top: 0; }
#docs-pointer .arrow { margin: -2px 0 0 -3px; filter: drop-shadow(0 1px 1.5px rgb(0 0 0 / 0.35));
	transition: scale 0.08s; transform-origin: 3px 2px; }
#docs-pointer .arrow:not(.is-on) { display: none; }
#docs-pointer .arrow.is-down { scale: 0.88; }
#docs-pointer .finger { width: 36px; height: 36px; margin: -18px 0 0 -18px; border-radius: 50%;
	background: rgb(128 128 128 / 0.45); border: 2px solid rgb(255 255 255 / 0.85);
	box-shadow: 0 1px 4px rgb(0 0 0 / 0.3); opacity: 0; transition: opacity 0.15s; }
#docs-pointer .finger.is-down { opacity: 1; }
#docs-pointer .ring { width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%;
	border: 2.5px solid var(--interactive-accent);
	background: color-mix(in srgb, var(--interactive-accent) 18%, transparent); }
`;

/**
 * Finds the one visible element that matches `css`, and contains `text` when
 * given, once nothing covers its center, and returns its rect.
 * @param {import("obsidian-e2e/capture").CdpClient} client @param {string} css @param {string} [text]
 * @returns {Promise<Rect>}
 */
async function locate(client, css, text = "") {
	const deadline = Date.now() + 10000;
	for (;;) {
		const { value, exception } = await client.evaluate(`(() => {
			const text = ${JSON.stringify(text)};
			const matches = [...document.querySelectorAll(${JSON.stringify(css)})].filter((el) => {
				const rect = el.getBoundingClientRect();
				return rect.width > 0 && rect.height > 0 && (!text || el.innerText.includes(text));
			});
			if (matches.length !== 1) return { count: matches.length };
			const rect = matches[0].getBoundingClientRect();
			const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
			if (!hit || !matches[0].contains(hit)) return { count: 1, covered: hit ? hit.className : "nothing" };
			return { count: 1, rect: rect.toJSON() };
		})()`);
		if (exception) throw new Error(exception);
		const found = /** @type {{ count: number, covered?: string, rect: Rect }} */ (value);
		if (found.rect) return found.rect;
		if (Date.now() > deadline) {
			throw new Error(`${css} ${text}: ${JSON.stringify(found)}, need one uncovered match.`);
		}
		await sleep(100);
	}
}

/** @param {Rect} rect @returns {Point} */
const center = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

/** Starts and ends slow, as a hand moves. @param {number} t */
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * Real input for a clip, sent straight to the instance's DevTools port so moves
 * stay smooth while the window records.
 * @param {import("obsidian-e2e/capture").CdpClient} client
 */
function hand(client) {
	/** @type {Point} */
	let at = { x: 0, y: 0 };
	let home = at;
	/** @param {string} type @param {Point} point @param {object} [extra] */
	const mouse = (type, { x, y }, extra = {}) =>
		client.call("Input.dispatchMouseEvent", { type, x, y, ...extra });
	/** @param {string} type @param {Point[]} points */
	const touch = (type, points) =>
		client.call("Input.dispatchTouchEvent", { type, touchPoints: points });
	/**
	 * Moves from `at` to `to` in `ms`, sending a step each frame. The clock sets
	 * each step, so a busy machine sends fewer steps but never slows the move.
	 */
	async function glide(
		/** @type {Point} */ to,
		/** @type {number} */ ms,
		/** @type {(point: Point) => Promise<unknown>} */ send,
	) {
		const from = at;
		const start = Date.now();
		for (let t = 0; t < 1;) {
			t = Math.min(1, (Date.now() - start) / ms);
			const e = ease(t);
			await send({ x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e });
			await sleep(16);
		}
		at = to;
	}
	return {
		/** Puts the mouse at a point without a visible move. @param {Point} point */
		async rest(point) {
			at = point;
			home = point;
			await mouse("mouseMoved", point);
		},
		/** Moves the mouse back to where it rested, so no tooltip stays up. */
		async away() {
			await glide(home, 650, (point) => mouse("mouseMoved", point));
		},
		/** Moves the mouse to the element and clicks it. @param {string} css @param {string} [text] */
		async click(css, text) {
			const to = center(await locate(client, css, text));
			await glide(to, 650, (point) => mouse("mouseMoved", point));
			await sleep(180);
			await mouse("mousePressed", to, { button: "left", buttons: 1, clickCount: 1 });
			await sleep(90);
			await mouse("mouseReleased", to, { button: "left", buttons: 0, clickCount: 1 });
		},
		/** Taps the element with a finger. @param {string} css @param {string} [text] */
		async tap(css, text) {
			const to = center(await locate(client, css, text));
			at = to;
			await touch("touchStart", [to]);
			await sleep(220);
			await touch("touchEnd", []);
		},
		/** Touches the element at `from` and drags it up to just above `to`. @param {string} from @param {string} to */
		async drag(from, to) {
			const start = center(await locate(client, from));
			const target = await locate(client, to);
			at = start;
			await touch("touchStart", [start]);
			await sleep(400);
			await glide({ x: start.x, y: target.y }, 1200, (point) => touch("touchMove", [point]));
			await sleep(350);
			await touch("touchEnd", []);
		},
		/** Swipes a finger `dy` px from the element's center, to scroll. @param {string} css @param {string} text @param {number} dy */
		async swipe(css, text, dy) {
			const start = center(await locate(client, css, text));
			at = start;
			await touch("touchStart", [start]);
			await glide({ x: start.x, y: start.y + dy }, 700, (point) =>
				touch("touchMove", [point]),
			);
			await touch("touchEnd", []);
		},
		/** Types into the focused field at a steady pace. @param {string} text */
		async type(text) {
			await typeText(client, text, { delayMs: 110 });
		},
		/** Pastes into the focused field. @param {string} text */
		async paste(text) {
			await client.call("Input.insertText", { text });
		},
	};
}

/**
 * Records `clip.act` in the current window and theme, cropped to the clip's
 * frame. Writes `<name>.mp4` and a `<name>.webp` poster of the moment `act` marks.
 * @param {string} name @param {Clip} clip @param {Library} lib
 */
async function record(name, clip, lib) {
	fs.mkdirSync(work, { recursive: true });
	const port = fs
		.readFileSync(path.join(instance.userDataPath, "DevToolsActivePort"), "utf8")
		.split("\n")[0];
	const master = path.join(work, `${name}.mp4`);
	await zoom(2);
	const client = await connectCapture({ port: Number(port), timeoutMs: 30000 });
	try {
		await evaluate(`
			document.getElementById("docs-capture")?.remove();
			document.head.createEl("style", { attr: { id: "docs-capture" },
				text: ${JSON.stringify(CAPTURE_CSS + POINTER_CSS)} });
			document.activeElement?.blur?.();
			document.querySelectorAll(".tooltip, .notice").forEach((el) => el.remove());
			return ${POINTER};
		`);
		await clip.ready?.();
		/** @type {Rect} */
		const rect = await evaluate(`return (${clip.frame})();`);
		const input = hand(client);
		if (clip.rest) await input.rest(clip.rest(rect));
		await sleep(500);
		let started = 0;
		let posterAt = 0;
		const { recording } = await withRecording(
			client,
			master,
			async () => {
				started = Date.now();
				await clip.act(input, () => (posterAt = (Date.now() - started) / 1000), lib);
			},
			{ fps: FPS, backend: "screencast", quality: 95 },
		);
		if (!posterAt) throw new Error(`${name} marked no poster frame.`);
		console.log(
			JSON.stringify({
				master: path.relative(root, master),
				seconds: recording.durationSeconds,
				frames: recording.capturedFrames,
				maxGap: recording.maxFrameGapSeconds,
			}),
		);
		await encode(master, rect, name, posterAt);
	} finally {
		client.close();
		await evaluate(`
			document.getElementById("docs-capture")?.remove();
			document.getElementById("docs-pointer")?.remove();
			return true;
		`);
		await zoom(1);
	}
}

/**
 * Crops the 2x master to `rect` and encodes it for the web, with a poster.
 * @param {string} master @param {Rect} rect @param {string} name @param {number} posterAt
 */
async function encode(master, rect, name, posterAt) {
	fs.mkdirSync(outDir, { recursive: true });
	const even = (/** @type {number} */ n) => Math.round(n) & ~1;
	const [x, y, width, height] = [rect.x, rect.y, rect.width, rect.height].map((n) => even(n * 2));
	const crop = `crop=${width}:${height}:${x}:${y}`;
	const out = path.join(outDir, `${name}.mp4`);
	// The screencast's frames are JPEGs, in full range.
	const filters = `${crop},scale=in_range=pc:out_range=tv,format=yuv420p`;
	const h264 = ["-c:v", "libx264", "-preset", "veryslow", "-crf", "30", "-tune", "animation"];
	const web = ["-color_range", "tv", "-movflags", "+faststart"];
	const source = ["-i", master, "-an", "-vf", filters];
	execFileSync("ffmpeg", ["-v", "error", "-y", ...source, ...h264, ...web, out]);
	const still = path.join(work, `${name}-poster.png`);
	const at = ["-ss", `${posterAt}`, "-i", master, "-frames:v", "1"];
	execFileSync("ffmpeg", ["-v", "error", "-y", ...at, "-vf", crop, still]);
	await sharp(still)
		.webp({ quality: 86 })
		.toFile(path.join(outDir, `${name}.webp`));
	console.log(
		JSON.stringify({ clip: path.relative(root, out), bytes: fs.statSync(out).size, posterAt }),
	);
}

/** @param {string} text */
async function waitForText(text) {
	await waitFor(
		`return document.querySelector(".podcast-view")?.innerText.includes(${JSON.stringify(text)});`,
		`The view did not show "${text}"`,
		10000,
	);
}

const PLAYING = `let state; app.plugins.plugins.podnotes.player.state.subscribe((value) => (state = value))();
	return state.status === "playing"`;

/**
 * Stages the network that the clips reach, as page source. PodNotes sends these
 * requests through requestUrl, which Obsidian forwards to its main process over
 * the `request-url` IPC channel: Apple Podcasts searches get the fixture
 * library's shows, and each address in `aliases` loads the feed it maps to.
 * @param {{ title: string, author: string, url: string, artworkUrl: string, count: number }[]} shows
 * @param {Record<string, string>} aliases
 */
const network = (shows, aliases) => `(() => {
	const ipc = window.electron.ipcRenderer;
	// Staging again replaces the stub instead of wrapping the last one.
	ipc.send = window.__docsSend ??= ipc.send;
	const send = ipc.send;
	const shows = ${JSON.stringify(shows)};
	const aliases = ${JSON.stringify(aliases)};
	ipc.send = function (channel, reply, request, ...rest) {
		if (channel === "request-url" && request?.url?.startsWith("https://itunes.apple.com/search?")) {
			const term = new URL(request.url).searchParams.get("term").toLowerCase();
			const results = shows.filter((show) => show.title.toLowerCase().includes(term)).map((show, n) => ({
				collectionName: show.title, artistName: show.author, feedUrl: show.url,
				artworkUrl100: show.artworkUrl, collectionId: 1000 + n, trackCount: show.count,
			}));
			const body = new TextEncoder().encode(JSON.stringify({ resultCount: results.length, results })).buffer;
			setTimeout(() => ipc.emit(reply, {}, { status: 200, headers: { "content-type": "application/json" }, body }), 250);
			return;
		}
		if (channel === "request-url" && aliases[request?.url]) request = { ...request, url: aliases[request.url] };
		return send.call(ipc, channel, reply, request, ...rest);
	};
	return true;
})()`;

/** @param {Library} lib */
async function stageNetwork(lib) {
	const local = (/** @type {string} */ url) => url.replace(`//${FIXTURE_HOST}:`, "//127.0.0.1:");
	const shows = await Promise.all(
		[...lib.feeds.filter((feed) => !feed.missing).map(({ feed }) => feed), lib.add].map(
			async (feed) => {
				const xml = await (await fetch(local(feed.url))).text();
				return { ...feed, count: xml.split("<item>").length - 1 };
			},
		),
	);
	const privateFeed = lib.feeds.find(({ feed }) => feed.title === PRIVATE_PODCAST)?.feed;
	if (!privateFeed) throw new Error(`The fixture library has no ${PRIVATE_PODCAST}.`);
	await evaluate(`return ${network(shows, { [PRIVATE_ADDRESS]: privateFeed.url })};`);
}

/**
 * The private podcast as another device sees it: synced with its reference,
 * but without its address in this device's secret storage.
 * @type {import("../../.claude/skills/verify/screens/scenes.mjs").Ingredient}
 */
function privateElsewhere(data, lib) {
	docsLibrary(data, lib);
	const feed = data.savedFeeds[PRIVATE_PODCAST];
	feed.url = `podnotes-private-feed:${encodeURIComponent(PRIVATE_PODCAST)}`;
	feed.urlSecretId = `podnotes-feed-url-${crypto.randomUUID()}`;
}

/** The view's own rect. */
const VIEW = `() => document.querySelector(".podcast-view").getBoundingClientRect().toJSON()`;
/** The window right of the ribbon: the note, and the view in the right sidebar. */
const BESIDE = `() => {
	const left = document.querySelector(".workspace-split.mod-root").getBoundingClientRect().left;
	return { x: left, y: 0, width: innerWidth - left, height: innerHeight };
}`;
/** @param {Rect} rect */
const restLow = (rect) => ({ x: rect.x + rect.width * 0.78, y: rect.y + rect.height * 0.82 });

/**
 * A clip on a docs page. `themes` are the themes its page shows screenshots in.
 * `setup` runs before the recording, `ready` once the window renders at 2x, and
 * `act` during the recording. `act` marks the poster's moment. `rest` places the
 * mouse in the frame before it starts, and a touch clip has none.
 * @typedef {{
 *   themes: ("light" | "dark")[],
 *   setup: (lib: Library) => Promise<void>,
 *   ready?: () => Promise<void>,
 *   frame: string,
 *   rest?: (rect: Rect) => Point,
 *   act: (input: ReturnType<typeof hand>, mark: () => void, lib: Library) => Promise<void>,
 * }} Clip
 */

/** @type {Record<string, Clip>} */
const CLIPS = {
	// Getting started: search for a show, add it, and play its first episode.
	"add-and-play": {
		themes: ["light", "dark"],
		async setup(lib) {
			await seed("empty");
			await place("pane");
			await stageNetwork(lib);
			await go({ kind: "library" });
			await waitForText("Add your first podcast");
		},
		frame: VIEW,
		rest: restLow,
		async act(input, mark, lib) {
			await sleep(1000);
			await input.click('.podcast-view input[aria-label="Search or paste a link"]');
			await sleep(300);
			await input.type("archive");
			await waitForText(lib.add.title);
			await sleep(1300);
			await input.click(`.podcast-view button.pn-result[aria-label="Add ${lib.add.title}"]`);
			await waitForText("Letters in the attic");
			await sleep(1400);
			await input.click(".podcast-view .pn-ep-main", "Letters in the attic");
			await waitFor(`${PLAYING};`, "The episode did not play");
			await sleep(1500);
			mark();
			await sleep(1500);
		},
	},
	// Capture timestamps: Timestamp in the full player while the episode plays,
	// then Undo in the notice.
	"capture-undo": {
		themes: ["light", "dark"],
		async setup(lib) {
			await seed("lists", docsLibrary);
			await place("sidebar");
			await playback(2200);
			const hero = plan.episodes.at(-1);
			const item = episode(lib, hero.podcast, hero.title);
			await writeNote({ ...hero, title: item.title });
			await evaluate(`
				const win = require("electron").remote.getCurrentWindow();
				win.setContentSize(864, 758);
				await new Promise((resolve) => setTimeout(resolve, 500));
				app.workspace.leftSplit.collapse();
				app.workspace.rightSplit.setSize(320);
				app.plugins.plugins.podnotes.navigation.expand();
				const editor = app.workspace.activeEditor.editor;
				const last = [...Array(editor.lineCount()).keys()].findLast((i) => /^- \\[\\d/.test(editor.getLine(i)));
				editor.focus();
				editor.setCursor(last, editor.getLine(last).length);
				editor.replaceSelection("\\n");
				const box = app.workspace.getLeavesOfType("markdown")[0].view.contentEl.querySelector(".metadata-container");
				if (!box.classList.contains("is-collapsed")) box.querySelector(".metadata-properties-heading").click();
				${API}.currentTime = ${hero.playAt};
				${API}.start();
				return true;
			`);
			await waitFor(`${PLAYING};`, "The episode did not play");
		},
		// Scrolls the Notes heading to the top. A resize scrolls the editor, so
		// this runs at 2x.
		async ready() {
			await evaluate(`
				const scroller = app.workspace.getLeavesOfType("markdown")[0].view.editor.cm.scrollDOM;
				for (let pass = 0; pass < 3; pass++) {
					const heading = [...scroller.querySelectorAll(".cm-line")].find((el) => el.textContent.trim() === "Notes");
					scroller.scrollTop += heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 20;
					await new Promise((resolve) => setTimeout(resolve, 200));
				}
				return true;
			`);
		},
		frame: BESIDE,
		rest: (rect) => ({ x: rect.x + 260, y: rect.y + rect.height * 0.8 }),
		async act(input, mark) {
			const timestamps = `app.workspace.getLeavesOfType("markdown")[0].view.editor.getValue().match(/^- \\[\\d/gm).length`;
			await sleep(1800);
			await input.click("section.pn-player button", "Timestamp");
			await waitFor(`return ${timestamps} === 5;`, "The capture did not reach the note");
			await sleep(1500);
			mark();
			await sleep(1300);
			await input.click(".notice button.pn-undo");
			await waitFor(`return ${timestamps} === 4;`, "Undo did not take the timestamp out");
			await sleep(1000);
			await input.away();
			await sleep(1800);
		},
	},
	// Use the player: the Transcript panel, a line to jump to, and a word to find.
	transcript: {
		themes: ["light", "dark"],
		async setup() {
			await seed("lists", docsLibrary);
			await place("pane");
			await go({ kind: "library" });
			await evaluate(`app.plugins.plugins.podnotes.navigation.expand(); return true;`);
			await playback(2290);
		},
		frame: VIEW,
		rest: restLow,
		async act(input, mark) {
			await sleep(1000);
			await input.click("section.pn-player button", "Transcript");
			await waitFor(
				`return Boolean(document.querySelector(".pn-tx button.pn-row.is-now"));`,
				"The transcript did not load",
			);
			await sleep(1500);
			await input.click(".pn-tx button.pn-row", "Then spaced repetition does the rest");
			await waitFor(`${PLAYING};`, "The line did not play");
			await sleep(1800);
			await input.click('.pn-tx button[aria-label="Find in transcript"]');
			await input.away();
			await input.type("walk");
			await sleep(1500);
			mark();
			await sleep(1500);
		},
	},
	// Use the queue and playlists: on a phone, drag a queue episode by its grip,
	// then open Up next in the full player.
	"queue-reorder": {
		themes: ["light", "dark"],
		async setup() {
			await seed("lists", docsLibrary);
			await place("phone");
			await go({ kind: "queue" });
			await waitForText("Ep. 88");
		},
		frame: `() => ({ x: 0, y: 0, width: innerWidth, height: innerHeight })`,
		async act(input, mark) {
			await sleep(1200);
			await input.drag(
				'.podcast-view button.pn-grip[aria-label*="position 3 of 3"]',
				'.podcast-view button.pn-grip[aria-label*="position 1 of 3"]',
			);
			await sleep(2000);
			await input.tap(".podcast-view button.pn-mini-open");
			await sleep(1500);
			await input.tap("section.pn-player button", "Up next");
			await sleep(1100);
			mark();
			await sleep(800);
			// The panel shows two episodes at a time, so it scrolls to the last one and
			// back, to end on the new order.
			await input.swipe(".pn-panel-scroll .pn-ep-main", "The case for boredom", -120);
			await sleep(1300);
			await input.swipe(".pn-panel-scroll .pn-ep-main", "The case for boredom", 120);
			await sleep(1500);
		},
	},
	// Use private feeds: on another device, a private podcast shows Address not
	// on this device until you set its address.
	"set-feed-address": {
		themes: ["light"],
		async setup(lib) {
			await seed("library", privateElsewhere);
			await place("pane");
			await stageNetwork(lib);
			await go({ kind: "library" });
			await waitFor(
				`return Boolean(document.querySelector('.podcast-view .pn-gridcard[aria-label^="${PRIVATE_PODCAST}"]'));`,
				`The library did not show ${PRIVATE_PODCAST}`,
			);
		},
		frame: VIEW,
		rest: restLow,
		async act(input, mark) {
			await sleep(1000);
			await input.click(`.podcast-view .pn-gridcard[aria-label^="${PRIVATE_PODCAST}"]`);
			await waitForText("Address not on this device");
			await sleep(1600);
			await input.click(".podcast-view button.pn-btn", "Set feed address");
			await sleep(700);
			await input.click(".modal input");
			await sleep(300);
			await input.paste(PRIVATE_ADDRESS);
			// Off the address, so the poster shows all of it.
			await input.away();
			await sleep(300);
			mark();
			await sleep(700);
			await input.click(".modal button.mod-cta", "Save");
			await waitFor(
				`return !document.querySelector(".podcast-view")?.innerText.includes("Feed didn't load") &&
					document.querySelectorAll(".podcast-view .pn-ep-main").length > 0;`,
				"The feed did not load from its address",
			);
			await input.away();
			await sleep(2200);
		},
	},
};

async function main() {
	const names = process.argv.slice(2);
	const unknown = names.filter((name) => !(name in CLIPS));
	if (unknown.length > 0) throw new Error(`No clip named ${unknown.join(", ")}.`);
	const lib = await library();
	for (const [name, clip] of Object.entries(CLIPS)) {
		if (names.length > 0 && !names.includes(name)) continue;
		for (const themeName of clip.themes) {
			await clip.setup(lib);
			await theme(themeName);
			await record(`${name}${themeName === "dark" ? "-dark" : ""}`, clip, lib);
		}
	}
	await seed("empty");
	await place("pane");
	await theme("light");
	console.log(`Wrote the clips to ${path.relative(root, outDir)}`);
}

await main();
