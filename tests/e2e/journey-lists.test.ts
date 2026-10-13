import type { ObsidianClient } from "obsidian-e2e";
import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	click,
	closePodNotes,
	drag,
	eventually,
	holdsFor,
	isShown,
	listedEpisodes,
	notices,
	pointOn,
	pressKey,
	pressMouse,
	reloadObsidian,
	runFromPalette,
	showLibrary,
	showList,
	showPodNotes,
	typeText,
	ui,
	type UiTarget,
	waitUntilFocused,
	waitUntilShown,
} from "./journey/actions";
import {
	type FixtureEpisode,
	type FixtureFeed,
	type FixtureServer,
	pubDate,
	startFixtureServer,
} from "./journey/fixtures";
import {
	playerLeafCount,
	readLibrary,
	seedLibrary,
	storedEpisode,
	waitForPlayback,
} from "./journey/library";
import { jsLiteral, PLUGIN_ID } from "./runtime";

const getContext = createPodNotesE2EHarness("journey-lists");

function episode(title: string, daysBefore: number, seconds = 6): FixtureEpisode {
	return { title, seconds, pubDate: pubDate(daysBefore), guid: title };
}

const ONE = episode("Queue One", 1);
const TWO = episode("Queue Two", 2);
const THREE = episode("Queue Three", 3);
const FOUR = episode("Queue Four", 4);
const PLAYING = episode("Playing Now", 5, 60);
const PICKED = episode("Picked Elsewhere", 6, 60);
const FEED: FixtureFeed = {
	title: "Journey Lists",
	slug: "lists",
	artwork: true,
	episodes: [ONE, TWO, THREE, FOUR, PLAYING, PICKED],
};
const QUEUE = [ONE, TWO, THREE, FOUR];
const titles = (episodes: readonly FixtureEpisode[]) => episodes.map(({ title }) => title);

async function serve(): Promise<FixtureServer> {
	const server = await startFixtureServer([FEED]);
	onTestFinished(() => server.stop());
	return server;
}

async function openQueue(current?: FixtureEpisode): Promise<FixtureServer> {
	const context = getContext();
	const server = await serve();
	await seedLibrary(context, server, {
		subscriptions: [FEED],
		queue: QUEUE.map((each) => storedEpisode(server, FEED, each)),
		current: current && storedEpisode(server, FEED, current),
	});
	await showPodNotes(context.obsidian);
	await showList(context.obsidian, "Queue");
	await waitUntilShown(context.obsidian, ui.queueGrip(ONE.title));
	return server;
}

async function expectQueue(expected: readonly string[]): Promise<void> {
	const { obsidian, plugin } = getContext();
	expect(
		await eventually(obsidian, () => listedEpisodes(obsidian), expected),
		"on screen",
	).toEqual(expected);
	expect(
		await eventually(obsidian, async () => (await readLibrary(plugin)).queue, expected),
		"in data.json",
	).toEqual(expected);
}

const focusedLabel = (obsidian: ObsidianClient) =>
	obsidian.dev.evalJson<string | null>(
		'document.activeElement?.getAttribute("aria-label") ?? null',
	);

async function expectGripFocused(title: string, position: number, count: number): Promise<void> {
	const label = `Reorder ${title}, position ${position} of ${count}. Use arrow keys to move.`;
	const { obsidian } = getContext();
	expect(await eventually(obsidian, () => focusedLabel(obsidian), label)).toBe(label);
}

async function playElsewhere(server: FixtureServer, episode: FixtureEpisode): Promise<void> {
	const { obsidian } = getContext();
	await obsidian.dev.evalJson(
		`app.plugins.plugins.${PLUGIN_ID}.player.play(${jsLiteral(storedEpisode(server, FEED, episode))}), true`,
	);
	await waitForPlayback(
		obsidian,
		(playback) => playback.episode?.title === episode.title && playback.seconds > 0,
		`${episode.title} playing`,
	);
	onTestFinished(() =>
		obsidian.dev.evalJson(`app.plugins.plugins.${PLUGIN_ID}.api.stop(), true`),
	);
}

async function rectOf(target: UiTarget): Promise<{ left: number; height: number }> {
	return await getContext().obsidian.dev.evalJson(
		`(() => { const { left, height } = (${target.elements})[0].getBoundingClientRect(); return { left, height }; })()`,
	);
}

describe("list journeys", () => {
	test("J-QUEUE-03 dragging a grip reorders the queue, on screen and in data, and the order survives a reload", async () => {
		const { obsidian } = getContext();
		await openQueue();

		await drag(obsidian, ui.queueGrip(FOUR.title), ui.queueRow(TWO.title), "bottom");
		await expectQueue(titles([ONE, TWO, FOUR, THREE]));
		await drag(obsidian, ui.queueGrip(ONE.title), ui.queueRow(FOUR.title), "top");
		await expectQueue(titles([TWO, ONE, FOUR, THREE]));

		await reloadObsidian(obsidian);
		await showPodNotes(obsidian);
		await showList(obsidian, "Queue");
		await expectQueue(titles([TWO, ONE, FOUR, THREE]));
	});

	test("J-QUEUE-03 arrow keys on a grip move its episode one place and keep focus on that grip", async () => {
		const { obsidian } = getContext();
		await openQueue();

		await click(obsidian, ui.queueGrip(TWO.title));
		await expectGripFocused(TWO.title, 2, 4);
		await pressKey(obsidian, "ArrowDown");
		await expectQueue(titles([ONE, THREE, TWO, FOUR]));
		await expectGripFocused(TWO.title, 3, 4);
		await pressKey(obsidian, "ArrowDown");
		await expectQueue(titles([ONE, THREE, FOUR, TWO]));
		await expectGripFocused(TWO.title, 4, 4);
		await pressKey(obsidian, "ArrowUp");
		await expectQueue(titles([ONE, THREE, TWO, FOUR]));
		await expectGripFocused(TWO.title, 3, 4);
	});

	test("a drag places its episode by the row it ends on when playback queues another episode mid-drag", async () => {
		const { obsidian } = getContext();
		const server = await openQueue(PLAYING);

		const mouse = await pressMouse(obsidian, await pointOn(obsidian, ui.queueGrip(FOUR.title)));
		await mouse.moveTo(await pointOn(obsidian, ui.queueRow(FOUR.title), "bottom"), 2);
		await playElsewhere(server, PICKED);
		expect(
			await eventually(obsidian, () => listedEpisodes(obsidian), titles([PLAYING, ...QUEUE])),
		).toEqual(titles([PLAYING, ...QUEUE]));
		await mouse.moveTo(await pointOn(obsidian, ui.queueRow(TWO.title), "top"));
		await mouse.release();

		await expectQueue(titles([PLAYING, ONE, FOUR, TWO, THREE]));
	});

	test("an arrow key moves its episode past its neighbour as the queue is now, after playback took the old neighbour", async () => {
		const { obsidian } = getContext();
		const server = await openQueue(PLAYING);

		await click(obsidian, ui.queueGrip(FOUR.title));
		await expectGripFocused(FOUR.title, 4, 4);
		await playElsewhere(server, THREE);
		await expectQueue(titles([PLAYING, ONE, TWO, FOUR]));
		await pressKey(obsidian, "ArrowUp");

		await expectQueue(titles([PLAYING, ONE, FOUR, TWO]));
		await expectGripFocused(FOUR.title, 3, 4);
	});

	test("a drag that leaves the list for the editor and moves past other rows there changes nothing", async () => {
		const { obsidian } = getContext();
		await openQueue();
		const grip = await pointOn(obsidian, ui.queueGrip(TWO.title));
		const view = await rectOf(ui.podcastViewport);
		const row = await rectOf(ui.queueRow(TWO.title));
		const outside = { x: view.left - 150, y: grip.y };

		const mouse = await pressMouse(obsidian, grip);
		await mouse.moveTo(outside);
		await mouse.moveTo({ ...outside, y: outside.y + 2.5 * row.height });
		await mouse.release();

		const order = titles(QUEUE);
		expect(await holdsFor(obsidian, () => listedEpisodes(obsidian), order)).toEqual(order);
		expect((await readLibrary(getContext().plugin)).queue).toEqual(order);
	});

	test("the episode a reorder puts first plays when the playing one ends, and leaves the queue", async () => {
		const { obsidian } = getContext();
		const server = await openQueue();
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(FEED.title));
		await click(obsidian, ui.episode(PLAYING.title));
		await waitForPlayback(
			obsidian,
			(playback) => playback.episode?.title === PLAYING.title && playback.seconds > 0,
			`${PLAYING.title} playing`,
		);
		await showList(obsidian, "Queue");

		await click(obsidian, ui.queueGrip(THREE.title));
		await pressKey(obsidian, "ArrowUp");
		await pressKey(obsidian, "ArrowUp");
		await expectQueue(titles([THREE, ONE, TWO, FOUR]));
		await obsidian.dev.evalJson(
			`(() => { const api = app.plugins.plugins.${PLUGIN_ID}.api; api.currentTime = api.length - 1; return true; })()`,
		);

		const next = await waitForPlayback(
			obsidian,
			(playback) =>
				playback.episode?.title === THREE.title && playback.playing && playback.seconds > 0,
			`${THREE.title} playing after ${PLAYING.title} ended`,
		);
		expect(next.media?.src).toBe(server.mediaUrl(FEED, THREE));
		await expectQueue(titles([ONE, TWO, FOUR]));
	});

	test("Reorder Queue opens the Queue page from a closed view, a view not loaded yet, and a view on another page", async () => {
		const { obsidian } = getContext();
		await openQueue();
		const queue = titles(QUEUE);

		await showList(obsidian, "Playlists");
		await closePodNotes(obsidian);
		await runFromPalette(obsidian, "Reorder Queue");
		await waitUntilShown(obsidian, ui.pageTitle("Queue"));
		expect(await listedEpisodes(obsidian)).toEqual(queue);
		expect(await playerLeafCount(obsidian)).toBe(1);

		// Behind another tab, the view loads only when revealed, and then restores the page it saved.
		await showList(obsidian, "Playlists");
		await obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getLeavesOfType(${jsLiteral("podcast_player_view")})[0];
			const other = app.workspace.createLeafInParent(leaf.parent, leaf.parent.children.length);
			await other.setViewState({ type: "empty" });
			leaf.parent.selectTab(other);
			await app.workspace.saveLayout();
			return true;
		})()`);
		await reloadObsidian(obsidian);
		expect(
			await obsidian.dev.evalJson<boolean[]>(
				`app.workspace.getLeavesOfType(${jsLiteral("podcast_player_view")}).map((leaf) => leaf.isDeferred)`,
			),
		).toEqual([true]);
		await runFromPalette(obsidian, "Reorder Queue");
		await waitUntilShown(obsidian, ui.pageTitle("Queue"));
		expect(await holdsFor(obsidian, () => listedEpisodes(obsidian), queue)).toEqual(queue);

		await showList(obsidian, "Latest episodes");
		await runFromPalette(obsidian, "Reorder Queue");
		await waitUntilShown(obsidian, ui.pageTitle("Queue"));
		expect(await listedEpisodes(obsidian)).toEqual(queue);
	});

	test("New playlist from an episode's Add to playlist menu keeps an empty name open, creates the named one with the episode, and refuses Favorites", async () => {
		const context = getContext();
		const { obsidian, plugin } = context;
		const server = await serve();
		await seedLibrary(context, server, {
			subscriptions: [FEED],
			playlists: [{ name: "Commute", removeAfterPlay: false, episodes: [] }],
		});
		const newPlaylistFor = async (title: string) => {
			await click(obsidian, ui.episodeMenu(title));
			await click(obsidian, ui.menuItem("Add to playlist"));
			await click(obsidian, ui.menuItem("New playlist"));
			await waitUntilFocused(obsidian, ui.textPromptField);
		};
		await showPodNotes(obsidian);
		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(FEED.title));

		await newPlaylistFor(TWO.title);
		await pressKey(obsidian, "Enter");
		expect(await holdsFor(obsidian, () => isShown(obsidian, ui.textPrompt), true, 1000)).toBe(
			true,
		);
		await waitUntilFocused(obsidian, ui.textPromptField);
		await typeText(obsidian, "Road trip");
		await pressKey(obsidian, "Enter");
		await obsidian.waitFor(async () => !(await isShown(obsidian, ui.textPrompt)), {
			timeoutMs: 5_000,
			message: "the prompt closed",
		});
		expect(
			await eventually(obsidian, async () => (await readLibrary(plugin)).playlists, {
				Commute: [],
				"Road trip": [TWO.title],
			}),
		).toEqual({ Commute: [], "Road trip": [TWO.title] });
		await showList(obsidian, "Playlists");
		await waitUntilShown(obsidian, ui.playlistRow("Road trip"));
		expect(
			await obsidian.dev.evalJson<string>(
				`(${ui.playlistRow("Road trip").elements})[0].querySelector(".s").textContent.trim()`,
			),
		).toBe("1 episode");

		await showLibrary(obsidian);
		await click(obsidian, ui.podcastCard(FEED.title));
		await newPlaylistFor(ONE.title);
		await typeText(obsidian, "Favorites");
		await pressKey(obsidian, "Enter");
		await obsidian.waitFor(
			async () =>
				(await notices(obsidian)).includes('"Favorites" is a reserved playlist name.'),
			{ timeoutMs: 5_000, message: "the reserved-name Notice" },
		);
		expect(await isShown(obsidian, ui.textPrompt)).toBe(false);
		expect(Object.keys((await readLibrary(plugin)).playlists)).toEqual([
			"Commute",
			"Road trip",
		]);
	});
});
