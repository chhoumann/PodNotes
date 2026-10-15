import { createHash } from "node:crypto";
import { mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
	createLocalEpisode,
	createPodNotesE2EHarness,
	type PodNotesData,
	seedAudio,
} from "./harness";
import { closePopoutAndReload, moveViewToPopout, showPodNotes } from "./journey/actions";
import { click } from "./journey/input";
import { ui } from "./journey/targets";
import { eventually, isShown, waitUntilShown } from "./journey/wait";
import { jsLiteral, PLUGIN_ID, RELOAD_OPTIONS, VIEW_TYPE, waitForPodNotesReady } from "./runtime";

const getContext = createPodNotesE2EHarness("update-styles");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RELEASE = "2.21.1";
const RELEASE_DIGESTS = {
	"main.js": "c1dc3560ad689e2df0d055209fb4d2a428c2233a348deedb62b9d87a7b9406ed",
	"manifest.json": "d58d070821e14b699fbc929db0d086232ebd13acf47804a28c1e3f35715508b0",
} as const;
type Artifact = keyof typeof RELEASE_DIGESTS;
type Bundle = Record<Artifact, Buffer>;
const ARTIFACTS = Object.keys(RELEASE_DIGESTS) as Artifact[];

// Stands for an earlier PodNotes sheet whose rule still matches the new markup.
const STALE_RULE = ".pn-mini .pn-iconbtn { color: rgb(255, 0, 0) !important; }";
const OTHER_PLUGIN_SHEET = "svelte-e2e-other";

type Where = "main" | "view";
type ButtonStyle = Record<"color" | "stroke" | "fill" | "opacity" | "size" | "background", string>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The released bundle from its GitHub release, cached in the git-ignored artifacts folder. */
async function releasedBundle(): Promise<Bundle> {
	const dir = path.join(ROOT, ".obsidian-e2e-artifacts/releases", RELEASE);
	await mkdir(dir, { recursive: true });
	const bundle = {} as Bundle;
	for (const name of ARTIFACTS) {
		const file = path.join(dir, name);
		let bytes = await readFile(file).catch(() => null);
		if (!bytes || sha256(bytes) !== RELEASE_DIGESTS[name]) {
			const url = `https://github.com/chhoumann/PodNotes/releases/download/${RELEASE}/${name}`;
			const response = await fetch(url);
			if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
			bytes = Buffer.from(await response.arrayBuffer());
			expect(sha256(bytes), `the ${RELEASE} ${name} digest`).toBe(RELEASE_DIGESTS[name]);
			await writeFile(file, bytes);
		}
		bundle[name] = bytes;
	}
	return bundle;
}

async function pluginDir(): Promise<string> {
	const { obsidian } = getContext();
	const dir = await obsidian.dev.evalJson<string>(
		`app.plugins.manifests[${jsLiteral(PLUGIN_ID)}].dir`,
	);
	return path.join(await obsidian.vaultPath(), dir);
}

/** Writes `bundle` over the plugin's files and reloads it the way Obsidian's updater does. */
async function install(dir: string, bundle: Bundle): Promise<void> {
	const { obsidian } = getContext();
	for (const name of ARTIFACTS) {
		await rm(path.join(dir, name));
		await writeFile(path.join(dir, name), bundle[name]);
	}
	await obsidian.dev.evalJsonAsync(`(async () => {
		const plugins = app.plugins;
		await plugins.loadManifest(plugins.manifests[${jsLiteral(PLUGIN_ID)}].dir);
		await plugins.disablePlugin(${jsLiteral(PLUGIN_ID)});
		await plugins.enablePlugin(${jsLiteral(PLUGIN_ID)}, true);
		return true;
	})()`);
	await waitForPodNotesReady(obsidian);
}

const viewDocument = `app.workspace.getLeavesOfType(${jsLiteral(VIEW_TYPE)})[0].view.containerEl.ownerDocument`;
const documentOf = (where: Where) => (where === "main" ? "document" : viewDocument);

async function plant(where: Where, id: string, css: string): Promise<void> {
	await getContext().obsidian.dev.evalJson(`(() => {
		const doc = ${documentOf(where)};
		const style = doc.createElement("style");
		style.id = ${jsLiteral(id)};
		style.textContent = ${jsLiteral(css)};
		doc.head.append(style);
		return true;
	})()`);
}

/** Ids of the PodNotes and test sheets in a document's head, in order, repeats kept. */
function sheetIds(where: Where): Promise<string[]> {
	return getContext().obsidian.dev.evalJson<string[]>(
		`[...(${documentOf(where)}).head.querySelectorAll("style[id]")].map((style) => style.id).filter((id) => /^(pn-|svelte-e2e-)/.test(id))`,
	);
}

/** The mini player's Play button as the view's window draws it. */
function playButton(): Promise<ButtonStyle | null> {
	return getContext().obsidian.dev.evalJson<ButtonStyle | null>(`(() => {
		const doc = ${viewDocument};
		const button = doc.querySelector(".pn-mini button[aria-label=Play]");
		if (!button) return null;
		const style = doc.defaultView.getComputedStyle(button);
		const svg = doc.defaultView.getComputedStyle(button.querySelector("svg"));
		return {
			color: style.color,
			stroke: svg.stroke,
			fill: svg.fill,
			opacity: style.opacity,
			size: style.width + " " + style.height,
			background: style.backgroundColor,
		};
	})()`);
}

/** Shows the mini player with a local episode in the main window, and reads its Play button. */
async function showMiniPlayer(): Promise<ButtonStyle> {
	const { obsidian, plugin, sandbox } = getContext();
	const audioPath = await seedAudio(obsidian, sandbox);
	await plugin.updateDataAndReload<PodNotesData>((data) => {
		data.currentEpisode = createLocalEpisode("E2E Update Styles", audioPath);
	}, RELOAD_OPTIONS);
	await waitForPodNotesReady(obsidian);
	await showPodNotes(obsidian);
	if (await isShown(obsidian, ui.fullPlayer)) await click(obsidian, ui.collapsePlayer);
	await waitUntilShown(obsidian, ui.miniPlayer);
	const play = await playButton();
	expect(play, "the mini player's Play button").not.toBeNull();
	return play!;
}

// A user runs the released version with the view where they left it, then updates.
test.each(["main window", "popout"] as const)(
	"updating PodNotes in place drops the previous bundle's sheets with the view in the %s",
	async (placement) => {
		const { obsidian, plugin } = getContext();
		const released = await releasedBundle();
		const dir = await pluginDir();
		const links = {} as Record<Artifact, string>;
		const current = {} as Bundle;
		for (const name of ARTIFACTS) {
			links[name] = await readlink(path.join(dir, name));
			current[name] = await readFile(path.resolve(dir, links[name]));
		}
		const fresh = await showMiniPlayer();
		try {
			await install(dir, released);
			if (placement === "popout") await moveViewToPopout(obsidian);
			await plant("main", "pn-e2e-stale-main", STALE_RULE);
			await plant("view", "pn-e2e-stale-view", STALE_RULE);
			await plant("main", OTHER_PLUGIN_SHEET, "");
			await plant("view", OTHER_PLUGIN_SHEET, "");

			await install(dir, current);

			const sheets = async () => {
				const ids = [await sheetIds("main"), await sheetIds("view")];
				return {
					stale: ids.flat().filter((id) => id.startsWith("pn-e2e-stale-")),
					repeated: ids.flatMap((list) =>
						list.filter(
							(id, index) => id.startsWith("pn-") && list.indexOf(id) !== index,
						),
					),
					other: ids.map((list) => list.includes(OTHER_PLUGIN_SHEET)),
				};
			};
			const clean = { stale: [], repeated: [], other: [true, true] };
			expect(await eventually(obsidian, sheets, clean)).toEqual(clean);
			expect(await eventually(obsidian, playButton, fresh)).toEqual(fresh);
			expect(
				await obsidian.dev.evalJson<boolean>(`(${viewDocument}) !== document`),
				"the view's window",
			).toBe(placement === "popout");
		} finally {
			// An install that failed part way may have removed an artifact already.
			for (const name of ARTIFACTS) {
				await rm(path.join(dir, name), { force: true });
				await symlink(links[name], path.join(dir, name));
			}
			if (placement === "popout") await closePopoutAndReload(obsidian);
			else await plugin.reload(RELOAD_OPTIONS);
		}
	},
	180_000,
);
