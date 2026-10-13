// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { get, writable } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { playlists, queue, savedFeeds } from "src/store";
import type { Playlist } from "src/types/Playlist";
import type { Episode } from "src/types/Episode";
import { fetchTextWithTimeout } from "src/utility/networkRequest";
import { isPrivateFeedPlaceholder, privateFeedPlaceholder } from "src/utility/privateFeedUrl";
import { deferred, MemoryStorage } from "../../tests/mocks/feeds";
import { FeedRepository, loadFeed } from "./FeedRepository";
import { FeedUrlRepository } from "./FeedUrlRepository";
import { createLibraryActions } from "./library";
import { resolveFeedUrl } from "./privateFeeds";

vi.mock("src/utility/networkRequest", async (importOriginal) => {
	const actual = await importOriginal<typeof import("src/utility/networkRequest")>();
	return { ...actual, fetchTextWithTimeout: vi.fn() };
});

const fetchTextMock = vi.mocked(fetchTextWithTimeout);
const PRIVATE_URL = "https://www.patreon.com/rss/show?auth=se-cret";

const online = writable(true);

function actionsOn(secrets: obsidian.SecretStorage) {
	const feedUrls = new FeedUrlRepository(secrets);
	const feeds = new FeedRepository({
		load: loadFeed,
		resolveUrl: (feed) => resolveFeedUrl(feed, feedUrls),
		storage: new MemoryStorage(),
		cache: () => ({ enabled: false, ttlHours: 6 }),
		now: Date.now,
	});
	return {
		actions: createLibraryActions({ app: new obsidian.App(), feeds, feedUrls, online }),
		feedUrls,
	};
}

function followedElsewhere() {
	const firstDevice = new obsidian.SecretStorage();
	const saved = {
		title: "Private Show",
		url: privateFeedPlaceholder("Private Show"),
		urlSecretId: new FeedUrlRepository(firstDevice).store(PRIVATE_URL),
		artworkUrl: "",
	};
	savedFeeds.set({ "Private Show": saved });
	const thisDevice = new obsidian.SecretStorage();
	return { saved, firstDevice, thisDevice, ...actionsOn(thisDevice) };
}

async function enterAddress(setting: Promise<void>, address: string) {
	const dialog = within(document.body);
	await fireEvent.input(dialog.getByRole("textbox", { name: "Feed address" }), {
		target: { value: address },
	});
	await fireEvent.click(dialog.getByRole("button", { name: "Save" }));
	await setting;
}

beforeEach(() => {
	online.set(true);
	savedFeeds.set({});
	fetchTextMock.mockReset();
	fetchTextMock.mockResolvedValue("<rss><channel><title>Private Show</title></channel></rss>");
});

afterEach(() => {
	savedFeeds.set({});
	queue.set(structuredClone(DEFAULT_SETTINGS.queue));
	playlists.set({});
	vi.restoreAllMocks();
});

/** The messages of the Notices shown, and a click on the last one's Undo. */
function notices() {
	const notice = vi.spyOn(obsidian, "Notice");
	return {
		texts: () =>
			notice.mock.calls.map(([message]) => (message as DocumentFragment).textContent),
		undo: () => {
			const [message] = notice.mock.calls.at(-1) ?? [];
			(message as DocumentFragment).querySelector("button")?.click();
		},
	};
}

describe("removing a podcast", () => {
	const shared = { title: "Shared", url: "https://feeds.example.com/shared.xml", artworkUrl: "" };

	test("removes only the podcast saved under its key, also when another shares its feed", () => {
		savedFeeds.set({ Shared: shared, "Shared Alias": { ...shared, title: "Shared Alias" } });

		actionsOn(new obsidian.SecretStorage()).actions.removePodcast("Shared Alias");

		expect(Object.keys(get(savedFeeds))).toEqual(["Shared"]);
	});

	test("removes a podcast whose title changed since it was saved", () => {
		savedFeeds.set({ "Old Name": { ...shared, title: "New Name" } });

		actionsOn(new obsidian.SecretStorage()).actions.removePodcast("Old Name");

		expect(get(savedFeeds)).toEqual({});
	});

	test("keeps a private feed's address while another saved podcast uses it", () => {
		const secrets = new obsidian.SecretStorage();
		const { actions, feedUrls } = actionsOn(secrets);
		const reference = feedUrls.store(PRIVATE_URL);
		const saved = { title: "Private Show", url: "", artworkUrl: "", urlSecretId: reference };
		savedFeeds.set({
			"Private Show": saved,
			Alias: { ...saved, urlSecretId: ` ${reference} ` },
		});

		actions.removePodcast("Alias");
		expect(secrets.getSecret(reference)).toBe(PRIVATE_URL);

		actions.removePodcast("Private Show");
		expect(get(savedFeeds)).toEqual({});
		expect(secrets.getSecret(reference)).toBeFalsy();
	});
});

describe("undoing Remove podcast", () => {
	const feed = (title: string) => ({
		title,
		url: `https://feeds.example.com/${title}.xml`,
		artworkUrl: `https://art.example.com/${title}.jpg`,
		author: "Someone",
	});

	test("puts the exact record back at its place in the grid, once", () => {
		const shown = notices();
		const { actions } = actionsOn(new obsidian.SecretStorage());
		savedFeeds.set({ First: feed("First"), Middle: feed("Middle"), Last: feed("Last") });

		actions.removePodcast("Middle");
		expect(Object.keys(get(savedFeeds))).toEqual(["First", "Last"]);
		expect(shown.texts()).toEqual(["Removed MiddleUndo"]);
		shown.undo();
		shown.undo();

		expect(Object.keys(get(savedFeeds))).toEqual(["First", "Middle", "Last"]);
		expect(get(savedFeeds).Middle).toEqual(feed("Middle"));
	});

	test("puts a private feed's address back under its reference, and never shows it", () => {
		const shown = notices();
		const secrets = new obsidian.SecretStorage();
		const { actions, feedUrls } = actionsOn(secrets);
		const saved = {
			title: "Private Show",
			url: privateFeedPlaceholder("Private Show"),
			urlSecretId: feedUrls.store(PRIVATE_URL),
			artworkUrl: "",
		};
		savedFeeds.set({ First: feed("First"), "Private Show": saved });

		actions.removePodcast("Private Show");
		expect(feedUrls.resolve(saved.urlSecretId)).toBeNull();
		shown.undo();

		expect(get(savedFeeds)["Private Show"]).toEqual(saved);
		expect(feedUrls.resolve(saved.urlSecretId)).toBe(PRIVATE_URL);
		expect(shown.texts().join()).not.toContain("se-cret");
	});

	test("leaves a podcast saved again since, under its key or at its address", () => {
		const shown = notices();
		const { actions } = actionsOn(new obsidian.SecretStorage());
		savedFeeds.set({ Middle: feed("Middle") });

		actions.removePodcast("Middle");
		const again = { ...feed("Middle"), author: "Someone else" };
		savedFeeds.set({ Middle: again });
		shown.undo();
		expect(get(savedFeeds)).toEqual({ Middle: again });

		actions.removePodcast("Middle");
		savedFeeds.set({ Renamed: { ...feed("Middle"), title: "Renamed" } });
		shown.undo();
		expect(Object.keys(get(savedFeeds))).toEqual(["Renamed"]);
	});
});

describe("editing a public feed's address", () => {
	const OLD_URL = "https://old.example.com/feed.xml";
	const NEW_URL = "https://new.example.com/feed.xml";
	const show = { title: "The Show", url: OLD_URL, artworkUrl: "" };

	function saved() {
		savedFeeds.set({
			First: { ...show, title: "First", url: "https://first.example.com/" },
			"The Show": show,
			Last: { ...show, title: "Last", url: "https://last.example.com/" },
		});
		return actionsOn(new obsidian.SecretStorage());
	}

	test("opens on its address and keeps the new one under the same key and place", async () => {
		const { actions } = saved();
		const edited = actions.setFeedAddress("The Show");
		expect(within(document.body).getByRole("textbox", { name: "Feed address" })).toHaveValue(
			OLD_URL,
		);

		await enterAddress(edited, NEW_URL);

		expect(Object.keys(get(savedFeeds))).toEqual(["First", "The Show", "Last"]);
		expect(get(savedFeeds)["The Show"]).toEqual({ ...show, url: NEW_URL });
		expect(fetchTextMock).toHaveBeenCalledWith(NEW_URL, expect.anything());
	});

	test("keeps a private address pasted for it as a secret, never in settings", async () => {
		const { actions, feedUrls } = saved();

		await enterAddress(actions.setFeedAddress("The Show"), PRIVATE_URL);

		const feed = get(savedFeeds)["The Show"];
		expect(isPrivateFeedPlaceholder(feed.url)).toBe(true);
		expect(feedUrls.resolve(feed.urlSecretId!)).toBe(PRIVATE_URL);
		expect(JSON.stringify(get(savedFeeds))).not.toContain("se-cret");
		expect(Object.keys(get(savedFeeds))).toEqual(["First", "The Show", "Last"]);
	});

	test("refuses an address another saved podcast has, before fetching it", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { actions } = saved();

		await enterAddress(actions.setFeedAddress("The Show"), "https://first.example.com/");

		expect(notice).toHaveBeenCalledWith("You already follow First at that address.");
		expect(fetchTextMock).not.toHaveBeenCalled();
		expect(get(savedFeeds)["The Show"]).toEqual(show);
	});

	test("keeps nothing for a feed that a sync changed while the address loaded", async () => {
		const response = deferred<string>();
		fetchTextMock.mockReturnValue(response.promise);
		const { actions } = saved();

		const entered = enterAddress(actions.setFeedAddress("The Show"), NEW_URL);
		await vi.waitFor(() => expect(fetchTextMock).toHaveBeenCalled());
		const synced = { ...show, url: "https://synced.example.com/feed.xml" };
		savedFeeds.update((all) => ({ ...all, "The Show": synced }));
		response.resolve("<rss><channel><title>The Show</title></channel></rss>");
		await entered;

		expect(get(savedFeeds)["The Show"]).toEqual(synced);
	});

	test("leaves alone a podcast removed and followed again at its old address while the new one loaded", async () => {
		const response = deferred<string>();
		fetchTextMock.mockReturnValue(response.promise);
		const { actions } = saved();

		const entered = enterAddress(actions.setFeedAddress("The Show"), NEW_URL);
		await vi.waitFor(() => expect(fetchTextMock).toHaveBeenCalled());
		actions.removePodcast("The Show");
		expect(actions.addPodcast({ ...show })).toBe("The Show");
		response.resolve("<rss><channel><title>The Show</title></channel></rss>");
		await entered;

		expect(get(savedFeeds)["The Show"]).toEqual(show);
	});

	test("loads nothing for a podcast removed while its address is typed", async () => {
		const { actions } = saved();

		const setting = actions.setFeedAddress("The Show");
		actions.removePodcast("The Show");
		await enterAddress(setting, NEW_URL);

		expect(fetchTextMock).not.toHaveBeenCalled();
		expect(Object.keys(get(savedFeeds))).toEqual(["First", "Last"]);
	});
});

describe("setting a feed's address needs a connection", () => {
	test("it is not asked for while offline", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { actions } = followedElsewhere();
		online.set(false);

		await actions.setFeedAddress("Private Show");

		expect(notice).toHaveBeenCalledWith("Setting a feed address needs a connection.");
		expect(within(document.body).queryByRole("textbox")).toBeNull();
	});

	test("one lost while the address is typed loads and keeps nothing", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { saved, thisDevice, actions } = followedElsewhere();

		const setting = actions.setFeedAddress("Private Show");
		online.set(false);
		await enterAddress(setting, PRIVATE_URL);

		expect(notice.mock.calls).toEqual([["Setting a feed address needs a connection."]]);
		expect(fetchTextMock).not.toHaveBeenCalled();
		expect(thisDevice.listSecrets()).toEqual([]);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
	});

	test("one lost while the address loads keeps nothing", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const response = deferred<string>();
		fetchTextMock.mockReturnValue(response.promise);
		const { saved, thisDevice, actions } = followedElsewhere();

		const entered = enterAddress(actions.setFeedAddress("Private Show"), PRIVATE_URL);
		await vi.waitFor(() => expect(fetchTextMock).toHaveBeenCalled());
		online.set(false);
		response.resolve("<rss><channel><title>Private Show</title></channel></rss>");
		await entered;

		expect(notice.mock.calls).toEqual([["Setting a feed address needs a connection."]]);
		expect(fetchTextMock).toHaveBeenCalledTimes(1);
		expect(thisDevice.listSecrets()).toEqual([]);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
	});
});

describe("setting a private feed's address on this device", () => {
	test("keeps it under the reference data.json holds", async () => {
		const { saved, firstDevice, thisDevice, actions } = followedElsewhere();

		await enterAddress(actions.setFeedAddress("Private Show"), PRIVATE_URL);

		expect(thisDevice.listSecrets()).toEqual([saved.urlSecretId]);
		expect(thisDevice.getSecret(saved.urlSecretId)).toBe(PRIVATE_URL);
		expect(firstDevice.getSecret(saved.urlSecretId)).toBe(PRIVATE_URL);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
	});

	test("refuses a public address before fetching it", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const { thisDevice, actions } = followedElsewhere();

		await enterAddress(
			actions.setFeedAddress("Private Show"),
			"https://public.example/feed.xml",
		);

		expect(fetchTextMock).not.toHaveBeenCalled();
		expect(notice).toHaveBeenCalledWith("Enter a private feed address.");
		expect(thisDevice.listSecrets()).toEqual([]);
	});

	test("keeps nothing when the feed at that address does not load, and never shows the address", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		vi.spyOn(console, "error").mockImplementation(() => {});
		fetchTextMock.mockRejectedValue(new Error(`Request to ${PRIVATE_URL} failed`));
		const { saved, thisDevice, actions } = followedElsewhere();

		await enterAddress(actions.setFeedAddress("Private Show"), PRIVATE_URL);

		expect(notice.mock.calls).toEqual([["Could not load the feed at that address."]]);
		expect(thisDevice.listSecrets()).toEqual([]);
		expect(get(savedFeeds)).toEqual({ "Private Show": saved });
	});

	test("keeps nothing for a feed that a sync replaced while the address loaded", async () => {
		const response = deferred<string>();
		fetchTextMock.mockReturnValue(response.promise);
		const { thisDevice, actions } = followedElsewhere();
		const replaced = {
			title: "Private Show",
			url: privateFeedPlaceholder("Private Show"),
			urlSecretId: "podnotes-feed-url-00000000-0000-4000-8000-000000000009",
			artworkUrl: "",
		};

		const entered = enterAddress(actions.setFeedAddress("Private Show"), PRIVATE_URL);
		await vi.waitFor(() => expect(fetchTextMock).toHaveBeenCalled());
		savedFeeds.set({ "Private Show": replaced });
		response.resolve("<rss><channel><title>Private Show</title></channel></rss>");
		await entered;

		expect(thisDevice.listSecrets()).toEqual([]);
		expect(get(savedFeeds)).toEqual({ "Private Show": replaced });
	});
});

describe("clearing the queue", () => {
	const episode = (title: string): Episode => ({
		title,
		streamUrl: `https://media.test/${title}.mp3`,
		url: "",
		description: "",
		content: "",
		podcastName: "Pod",
	});
	const titles = () => get(queue).episodes.map(({ title }) => title);
	const fill = (...names: string[]) =>
		queue.set({ ...structuredClone(DEFAULT_SETTINGS.queue), episodes: names.map(episode) });

	test("empties it, and Undo puts every entry back in order, once", () => {
		const shown = notices();
		const { actions } = actionsOn(new obsidian.SecretStorage());
		fill("A", "B", "C");

		actions.clearQueue();
		expect(titles()).toEqual([]);
		expect(shown.texts()).toEqual(["Queue clearedUndo"]);

		shown.undo();
		expect(titles()).toEqual(["A", "B", "C"]);
		actions.setQueued(episode("A"), false);
		shown.undo();
		expect(titles()).toEqual(["B", "C"]);
	});

	test("Undo leaves a queue that playback or the user filled since", () => {
		const shown = notices();
		const { actions } = actionsOn(new obsidian.SecretStorage());
		fill("A", "B");

		actions.clearQueue();
		actions.setQueued(episode("New"), true);
		shown.undo();

		expect(titles()).toEqual(["New"]);
	});

	test("an empty queue clears without a notice", () => {
		const shown = notices();
		const { actions } = actionsOn(new obsidian.SecretStorage());
		let writes = 0;
		const unsubscribe = queue.subscribe(() => writes++);

		actions.clearQueue();
		unsubscribe();

		expect(shown.texts()).toEqual([]);
		expect(writes).toBe(1);
	});
});

describe("playlists", () => {
	const list = (name: string, changes: Partial<Playlist> = {}): Playlist => ({
		name,
		icon: "list-music",
		episodes: [],
		shouldEpisodeRemoveAfterPlay: false,
		shouldRepeat: false,
		...changes,
	});
	const show: Episode = {
		title: "First",
		streamUrl: "https://media.test/first.mp3",
		url: "",
		description: "",
		content: "",
		podcastName: "Pod",
	};

	async function create(name: string, episode?: Episode) {
		const { actions } = actionsOn(new obsidian.SecretStorage());
		const created = actions.createPlaylist(episode);
		const dialog = within(document.body);
		await fireEvent.input(dialog.getByRole("textbox", { name: "Playlist name" }), {
			target: { value: name },
		});
		await fireEvent.click(dialog.getByRole("button", { name: "Create" }));
		return await created;
	}

	test("New playlist creates one under its trimmed name, with the episode it was asked from", async () => {
		expect(await create("  My Shows  ", show)).toBe("My Shows");

		expect(get(playlists)).toEqual({ "My Shows": list("My Shows", { episodes: [show] }) });
	});

	test("refuses a built-in list's name, Played's too", async () => {
		const notice = vi.spyOn(obsidian, "Notice");

		expect(await create("Favorites")).toBeNull();
		expect(await create("Played")).toBeNull();

		expect(notice.mock.calls).toEqual([
			['"Favorites" is a reserved playlist name.'],
			['"Played" is a reserved playlist name.'],
		]);
		expect(get(playlists)).toEqual({});
	});

	test("refuses a name already taken, also after trimming, and keeps the playlist there", async () => {
		const notice = vi.spyOn(obsidian, "Notice");
		const existing = list("Walks", { episodes: [show], icon: "star" });
		playlists.set({ Walks: existing });

		expect(await create("Walks")).toBeNull();
		expect(await create(" Walks ")).toBeNull();

		expect(notice.mock.calls).toEqual([
			["A playlist with that name already exists."],
			["A playlist with that name already exists."],
		]);
		expect(get(playlists).Walks).toBe(existing);
	});

	test("cancelling creates nothing", async () => {
		const { actions } = actionsOn(new obsidian.SecretStorage());
		const created = actions.createPlaylist();
		await fireEvent.click(within(document.body).getByRole("button", { name: "Cancel" }));

		expect(await created).toBeNull();
		expect(get(playlists)).toEqual({});
	});

	test("Undo puts a deleted playlist back whole, where it was, unless its name was taken since", () => {
		const shown = notices();
		const { actions } = actionsOn(new obsidian.SecretStorage());
		const runs = list("Runs", { episodes: [show], icon: "bike", shouldRepeat: true });
		playlists.set({ Walks: list("Walks"), Runs: runs, Rides: list("Rides") });

		actions.deletePlaylist("Runs");
		expect(Object.keys(get(playlists))).toEqual(["Walks", "Rides"]);
		expect(shown.texts()).toEqual(["Deleted RunsUndo"]);
		shown.undo();
		expect(Object.keys(get(playlists))).toEqual(["Walks", "Runs", "Rides"]);
		expect(get(playlists).Runs).toEqual(runs);

		actions.deletePlaylist("Runs");
		const newer = list("Runs");
		playlists.update((all) => ({ ...all, Runs: newer }));
		shown.undo();
		expect(Object.keys(get(playlists))).toEqual(["Walks", "Rides", "Runs"]);
		expect(get(playlists).Runs).toBe(newer);
	});

	test("deleting a playlist that is gone shows nothing", () => {
		const shown = notices();
		actionsOn(new obsidian.SecretStorage()).actions.deletePlaylist("Gone");

		expect(shown.texts()).toEqual([]);
	});
});
