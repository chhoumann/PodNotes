// @vitest-environment jsdom
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import PodNotes from "./main";
import { encodePodNotesData } from "./persistence/podNotesData";
import { createLibraryActions } from "./services/library";
import { savedFeeds } from "./store";
import { privateFeedPlaceholder } from "./utility/privateFeedUrl";
import { dataFileText } from "../tests/mocks/dataFileWriter";

const ADDRESS = "https://www.patreon.com/rss/show?auth=se-cret";
const REFERENCE = "podnotes-feed-url-00000000-0000-4000-8000-000000000001";
const SHOW = {
	title: "Private Show",
	url: privateFeedPlaceholder("Private Show"),
	urlSecretId: REFERENCE,
	artworkUrl: "",
};

let loaded: PodNotes | undefined;

beforeEach(() => {
	// jsdom implements no media loading; unload releases the player's element.
	vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
	loaded?.onunload();
	loaded = undefined;
	savedFeeds.set({});
	vi.restoreAllMocks();
});

async function loadPlugin(secrets: obsidian.SecretStorage): Promise<PodNotes> {
	const disk = encodePodNotesData({
		...structuredClone(DEFAULT_SETTINGS),
		savedFeeds: { [SHOW.title]: SHOW },
	});
	const plugin = Object.create(PodNotes.prototype) as PodNotes;
	Object.assign(plugin, {
		loadData: vi.fn(async () => structuredClone(disk)),
		saveData: vi.fn(async () => {}),
		addCommand: vi.fn(),
		addRibbonIcon: vi.fn(() => document.createElement("div")),
		addSettingTab: vi.fn(),
		registerView: vi.fn(),
		registerObsidianProtocolHandler: vi.fn(),
		registerEvent: vi.fn(),
		registerDomEvent: vi.fn(),
		closing: null,
		writeInFlight: null,
		storeUnsubscribers: [],
		views: new Set(),
		manifest: { dir: ".obsidian/plugins/podnotes" },
		app: {
			loadLocalStorage: vi.fn(() => null),
			saveLocalStorage: vi.fn(),
			secretStorage: secrets,
			vault: {
				on: vi.fn(() => ({})),
				adapter: {
					exists: vi.fn(async () => true),
					read: vi.fn(async () => dataFileText(disk)),
				},
			},
			workspace: {
				onLayoutReady: vi.fn(),
				on: vi.fn(() => ({})),
				offref: vi.fn(),
				getLeavesOfType: vi.fn(() => []),
				iterateAllLeaves: vi.fn(),
				getActiveViewOfType: vi.fn(() => null),
			},
		},
	});
	await plugin.onload();
	loaded = plugin;
	return plugin;
}

test("an Undo of Remove podcast still offered when PodNotes unloads is hidden, and clicking it brings back neither the podcast nor its private address", async () => {
	const secrets = new obsidian.SecretStorage();
	secrets.setSecret(REFERENCE, ADDRESS);
	const notice = vi.spyOn(obsidian, "Notice");
	const plugin = await loadPlugin(secrets);
	// The actions as the view's services hold them.
	const actions = createLibraryActions({
		app: plugin.app,
		feeds: plugin.feeds,
		feedUrls: plugin.feedUrls,
		online: plugin.online,
	});
	actions.removePodcast(SHOW.title);
	const shown = notice.mock.calls.findIndex(
		([message]) => (message as DocumentFragment).textContent === "Removed Private ShowUndo",
	);
	const [message] = notice.mock.calls[shown];
	expect(get(savedFeeds)).toEqual({});
	expect(secrets.getSecret(REFERENCE)).toBe("");

	plugin.onunload();
	loaded = undefined;
	(message as DocumentFragment).querySelector("button")?.click();

	expect(get(savedFeeds)).toEqual({});
	expect(secrets.getSecret(REFERENCE)).toBe("");
	expect((notice.mock.instances[shown] as unknown as { hidden: boolean }).hidden).toBe(true);
});
