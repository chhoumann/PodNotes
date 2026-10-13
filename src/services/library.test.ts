// @vitest-environment jsdom
import { fireEvent, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { savedFeeds } from "src/store";
import { fetchTextWithTimeout } from "src/utility/networkRequest";
import { privateFeedPlaceholder } from "src/utility/privateFeedUrl";
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
		actions: createLibraryActions({ app: new obsidian.App(), feeds, feedUrls }),
		feedUrls,
	};
}

/** A private feed followed on another device: its reference is in data.json, its address is not here. */
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

/** Answers the feed address dialog that `setting` opens. */
async function enterAddress(setting: Promise<void>, address: string) {
	const dialog = within(document.body);
	await fireEvent.input(dialog.getByRole("textbox", { name: "Feed address" }), {
		target: { value: address },
	});
	await fireEvent.click(dialog.getByRole("button", { name: "Save" }));
	await setting;
}

beforeEach(() => {
	savedFeeds.set({});
	fetchTextMock.mockReset();
	fetchTextMock.mockResolvedValue("<rss><channel><title>Private Show</title></channel></rss>");
});

afterEach(() => {
	savedFeeds.set({});
	vi.restoreAllMocks();
});

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
