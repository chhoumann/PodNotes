// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { flushSync, tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { plugin, queue } from "src/store";
import type { Episode } from "src/types/Episode";
import { isLocalFile } from "src/utility/isLocalFile";
import type { FakeDocument } from "../../../tests/mocks/fakeMedia";
import type { Keymap as FakeKeymap, Menu as FakeMenu } from "../../../tests/mocks/obsidian";
import { openPopout } from "../../../tests/mocks/popout";
import {
	installResizeObserver,
	type FakeResizeObservers,
} from "../../../tests/mocks/resizeObserver";
import {
	createTestServices,
	pluginLibrary,
	type TestServices,
} from "../../../tests/mocks/services";
import PodcastView from "./PodcastView.svelte";

vi.mock("src/utility/fetchChapters", () => ({
	fetchChapters: async () =>
		["Intro", "Memory palaces", "Questions"].map((title, index) => ({
			title,
			startTime: index * 600,
		})),
}));

const episode: Episode = {
	title: "How to remember everything",
	streamUrl: "https://pod.test/remember.mp3",
	url: "https://pod.test/remember",
	description: "",
	content: "",
	podcastName: "Field Notes",
	artworkUrl: "https://pod.test/art.jpg",
	duration: 1800,
};
const withChapters = { ...episode, chaptersUrl: "https://pod.test/chapters.json" };
const queued = (title: string): Episode => ({
	...episode,
	title,
	streamUrl: `https://pod.test/${title}.mp3`,
	duration: 1200,
});

let services: TestServices;
let doc: FakeDocument;
let dispose: () => void;
let widths: FakeResizeObservers;

beforeEach(() => {
	({ services, doc, dispose } = createTestServices({ library: pluginLibrary }));
	widths = installResizeObserver();
});

afterEach(() => {
	widths.uninstall();
	dispose();
	queue.set(structuredClone(DEFAULT_SETTINGS.queue));
	vi.restoreAllMocks();
});

/** The full player over `played`, playing at 10:00 of 30:00, in a view `width` wide. */
async function openPlayer(played: Episode = episode, width = 320) {
	const result = render(PodcastView, { props: { services } });
	widths.resize(result.container.querySelector(".podcast-view")!, width);
	if (isLocalFile(played)) {
		services.player.restore(played);
	} else {
		services.player.play(played);
		doc.media.duration = 1800;
		doc.media.emit("loadedmetadata");
		doc.media.currentTime = 600;
		doc.media.emit("timeupdate");
	}
	services.navigation.expand();
	await tick();
	await tick();
	return { ...result, player: screen.getByRole("region", { name: "Player" }) };
}

const button = (name: string | RegExp) => screen.getByRole("button", { name });
const keymap = () => services.app.keymap as unknown as FakeKeymap;
const press = (key: string, target: Element = document.activeElement ?? document.body) => {
	const event = new KeyboardEvent("keydown", { key, bubbles: true });
	Object.defineProperty(event, "target", { value: target });
	keymap().dispatch(event);
};
const shownMenu = () => (obsidian.Menu as unknown as typeof FakeMenu).shown!;

describe("the full player", () => {
	test("shows the artwork, and a file tile for a local file or artwork that fails to load (#394)", async () => {
		const { player } = await openPlayer();
		const art = player.querySelector("img.pn-np-art")!;
		expect(art).toHaveAttribute("src", episode.artworkUrl);

		await fireEvent.error(art);

		expect(player.querySelector("img")).toBeNull();
		expect(player.querySelector(".pn-np-art.pn-filetile")).toHaveAttribute(
			"data-icon",
			"music",
		);
	});

	test("a local file shows a file tile, and its folder links to Local files", async () => {
		const local: Episode = {
			...episode,
			podcastName: "local file",
			artworkUrl: undefined,
			filePath: "Lectures/Week 7.mp3",
		} as Episode;
		const { player } = await openPlayer(local);

		expect(player.querySelector("img")).toBeNull();
		expect(player.querySelector(".pn-np-art.pn-filetile")).toHaveAttribute(
			"data-icon",
			"music",
		);
		await fireEvent.click(within(player).getByRole("button", { name: "Lectures" }));
		expect(services.navigation.current.page).toEqual({ kind: "local" });
	});

	test("the rate pill shows the live rate once, and its menu sets another", async () => {
		const { player } = await openPlayer();
		services.player.setPlaybackRate(1.25);
		await tick();
		const pill = button("Playback speed 1.25x");
		expect(within(player).getAllByText("1.25×")).toEqual([pill.firstElementChild]);

		await fireEvent.click(pill);
		shownMenu().pick("1.75×");
		await tick();

		expect(get(services.player.state).playbackRate).toBe(1.75);
		expect(button("Playback speed 1.75x")).toHaveTextContent("1.75×");
		expect(button("Playback speed 1.75x")).toHaveFocus();
	});

	test("the volume button opens a slider that sets the volume, shown once as a percent", async () => {
		const { player } = await openPlayer();
		services.player.setVolume(0.4);
		await tick();

		await fireEvent.click(button("Volume 40%"));
		expect(button("Volume 40%")).toHaveAttribute("aria-expanded", "true");
		await fireEvent.input(screen.getByRole("slider", { name: "Volume" }), {
			target: { value: "0.65" },
		});

		expect(get(services.player.state).volume).toBe(0.65);
		expect(within(player).getAllByText("65%")).toHaveLength(1);
		expect(button("Volume 65%")).toBeInTheDocument();
	});

	test("Escape closes the volume slider first, then collapses the player", async () => {
		await openPlayer();
		await fireEvent.click(button("Volume 100%"));

		press("Escape", screen.getByRole("slider", { name: "Volume" }));
		await tick();
		expect(screen.queryByRole("slider", { name: "Volume" })).toBeNull();
		expect(button("Volume 100%")).toHaveFocus();
		expect(services.navigation.current.expanded).toBe(true);

		press("Escape");
		await tick();
		expect(services.navigation.current.expanded).toBe(false);
	});

	test("a press outside the volume slider closes it", async () => {
		await openPlayer();
		await fireEvent.click(button("Volume 100%"));

		await fireEvent.pointerDown(button("Pause"));

		expect(screen.queryByRole("slider", { name: "Volume" })).toBeNull();
	});

	test("Space plays and pauses, except on a control", async () => {
		const { player } = await openPlayer();

		press(" ", player);
		expect(get(services.player.state).status).toBe("paused");
		press(" ", button("Volume 100%"));
		expect(get(services.player.state).status).toBe("paused");
		press(" ", document.body);

		expect(get(services.player.state).status).toBe("playing");
	});

	test("the skip buttons name and skip the configured lengths", async () => {
		get(plugin).settings.skipBackwardLength = 10;
		get(plugin).settings.skipForwardLength = 45;
		plugin.update((host) => host);
		await openPlayer();

		await fireEvent.click(button("Back 10 seconds"));
		await fireEvent.click(button("Forward 45 seconds"));

		expect(button("Back 10 seconds")).toHaveTextContent("10");
		expect(services.api.skipBackward).toHaveBeenCalledTimes(1);
		expect(services.api.skipForward).toHaveBeenCalledTimes(1);
		Object.assign(get(plugin).settings, { skipBackwardLength: 15, skipForwardLength: 15 });
	});

	test("when the media fails, the stage says so and Retry loads it again; the transport waits", async () => {
		const { player } = await openPlayer();

		doc.media.emit("error");
		await tick();

		const alert = within(player).getByRole("alert");
		expect(alert).toHaveTextContent("Could not load this episode's media.");
		for (const name of ["Play", "Back 15 seconds", "Forward 15 seconds", /^Playback speed/]) {
			expect(button(name)).toBeDisabled();
		}
		expect(button(/^Volume/)).toBeDisabled();
		expect(screen.getByRole("slider", { name: "Seek" })).toHaveAttribute(
			"aria-disabled",
			"true",
		);
		expect(button("Capture timestamp")).toBeEnabled();
		expect(button("Episode options")).toBeEnabled();

		await fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
		await tick();

		expect(get(services.player.state).status).toBe("loading");
		expect(within(player).queryByRole("alert")).toBeNull();
		expect(button("Pause")).toBeEnabled();
	});

	test("Create note while the episode has none, Open note once it has one", async () => {
		await openPlayer();
		expect(button("Create note")).toBeInTheDocument();

		services.hasNote.mockReturnValue(true);
		services.rowHasNote.set(() => true);
		await tick();

		expect(button("Open note")).toBeInTheDocument();
	});

	test("Timestamp reads Added for 1.2 s after a capture, and not when nothing was captured", async () => {
		await openPlayer();
		const timestamp = button("Capture timestamp");
		const reads = () => [
			timestamp.textContent,
			timestamp.querySelector("[data-icon]")?.getAttribute("data-icon"),
		];
		vi.useFakeTimers();
		onTestFinished(() => void vi.useRealTimers());

		await fireEvent.click(timestamp);
		await tick();
		expect(reads()).toEqual(["Timestamp", "clock-plus"]);

		services.captureTimestamp.mockResolvedValueOnce({
			destination: "note",
			path: "PodNotes/Field Notes/How to remember everything.md",
			text: "- 00:10:00\n",
			created: false,
		});
		await fireEvent.click(timestamp);
		await tick();
		expect(reads()).toEqual(["Added", "check"]);

		vi.advanceTimersByTime(1199);
		await tick();
		expect(reads()).toEqual(["Added", "check"]);
		vi.advanceTimersByTime(1);
		await tick();
		expect(reads()).toEqual(["Timestamp", "clock-plus"]);
	});

	test("a video plays on the stage, which offers fullscreen", async () => {
		const stage = vi.spyOn(services.player, "videoStage");
		const { player } = await openPlayer({ ...episode, mediaType: "video" });

		const frame = player.querySelector(".pn-video");
		expect(stage).toHaveBeenCalledWith(frame);
		expect(
			within(frame as HTMLElement).getByRole("button", { name: "Fullscreen" }),
		).toBeInTheDocument();
	});

	test("a video in a popout shows its artwork, since the video plays in the main window", async () => {
		const popout = openPopout();
		const { container, player } = await openPlayer({ ...episode, mediaType: "video" });

		popout.moveIn(container);
		await tick();

		expect(player.querySelector(".pn-video")).toBeNull();
		expect(player.querySelector("img.pn-np-art")).not.toBeNull();
	});
});

describe("the player's panels", () => {
	const switchButton = (name: string) =>
		within(screen.getByRole("group", { name: "Player panels" })).getByRole("button", { name });

	test("at compact width, a panel replaces the artwork until it is chosen again", async () => {
		const { player } = await openPlayer(withChapters);
		await vi.waitFor(() => expect(switchButton("Chapters")).toBeInTheDocument());
		expect(player.querySelector(".pn-np-art")).not.toBeNull();

		await fireEvent.click(switchButton("Up next"));
		expect(switchButton("Up next")).toHaveAttribute("aria-pressed", "true");
		expect(player.querySelector(".pn-np-art")).toBeNull();
		expect(within(player).getByText("Queue is empty")).toBeInTheDocument();

		await fireEvent.click(switchButton("Up next"));
		expect(player.querySelector(".pn-np-art")).not.toBeNull();
	});

	test("an episode without chapters offers no Chapters", async () => {
		await openPlayer();

		expect(
			within(screen.getByRole("group", { name: "Player panels" })).getAllByRole("button"),
		).toEqual([switchButton("Up next")]);
	});

	test("at wide width, the right column shows Chapters, or Up next without chapters", async () => {
		await openPlayer(withChapters, 820);
		await vi.waitFor(() =>
			expect(screen.getByRole("tab", { name: "Chapters" })).toHaveAttribute(
				"aria-selected",
				"true",
			),
		);
		expect(screen.getByRole("list", { name: "Chapters" })).toBeInTheDocument();

		services.player.play(queued("Without chapters"));
		await tick();
		await tick();

		expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Up next"]);
		expect(screen.getByRole("tab", { name: "Up next" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("a reopened player shows the chapters it loaded on its first frame", async () => {
		await openPlayer({ ...episode, chaptersUrl: "https://pod.test/reopened.json" }, 820);
		await vi.waitFor(() => expect(screen.getByRole("tab", { name: "Chapters" })).toBeVisible());
		await fireEvent.click(button("Collapse player"));

		flushSync(() => services.navigation.expand());

		expect(screen.getByRole("tab", { name: "Chapters" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});

	test("a choice of Chapters stays with its episode", async () => {
		const { player } = await openPlayer(withChapters);
		await vi.waitFor(() => expect(switchButton("Chapters")).toBeInTheDocument());
		await fireEvent.click(switchButton("Chapters"));
		services.player.play(queued("Without chapters"));
		await tick();

		services.player.play({
			...queued("Also with chapters"),
			chaptersUrl: "https://pod.test/also.json",
		});
		await vi.waitFor(() => expect(switchButton("Chapters")).toBeInTheDocument());

		expect(switchButton("Chapters")).toHaveAttribute("aria-pressed", "false");
		expect(player.querySelector(".pn-np-art")).not.toBeNull();
	});

	test("the current chapter is named under the scrubber, opens Chapters, and is marked there", async () => {
		await openPlayer(withChapters);
		await vi.waitFor(() => expect(button("Memory palaces")).toBeInTheDocument());

		await fireEvent.click(button("Memory palaces"));
		const chapters = screen.getByRole("list", { name: "Chapters" });
		const current = within(chapters).getByRole("button", { name: /Memory palaces/ });
		expect(current).toHaveAttribute("aria-current", "true");

		doc.media.currentTime = 1250;
		doc.media.emit("timeupdate");
		await tick();
		expect(within(chapters).getByRole("button", { name: /Questions/ })).toHaveAttribute(
			"aria-current",
			"true",
		);
		expect(current).not.toHaveAttribute("aria-current");
	});

	test("a chapter plays from its start", async () => {
		await openPlayer(withChapters);
		await vi.waitFor(() => expect(switchButton("Chapters")).toBeInTheDocument());
		services.player.pause();
		await fireEvent.click(switchButton("Chapters"));

		await fireEvent.click(screen.getByRole("button", { name: /^0:00 Intro/ }));

		expect(get(services.player.state)).toMatchObject({ currentTime: 0, status: "playing" });
	});

	describe("Up next", () => {
		const [one, two, three] = ["One", "Two", "Three"].map(queued);

		async function openUpNext() {
			queue.set({ ...structuredClone(DEFAULT_SETTINGS.queue), episodes: [one, two, three] });
			const result = await openPlayer();
			await fireEvent.click(switchButton("Up next"));
			return result;
		}

		const listed = () =>
			within(screen.getByRole("list", { name: "Queue" }))
				.getAllByRole("listitem")
				.map((row) => row.querySelector(".pn-ep-title")?.textContent);

		test("lists the queue with its count and time left, and Edit opens the Queue page", async () => {
			const { player } = await openUpNext();

			expect(within(player).getByText("3 episodes · 1 h 0 min")).toBeInTheDocument();
			expect(listed()).toEqual(["One", "Two", "Three"]);
			await fireEvent.click(within(player).getByRole("button", { name: "Edit" }));

			expect(services.navigation.current).toMatchObject({
				page: { kind: "queue" },
				expanded: false,
			});
		});

		test("reorders in place, writing the queue once per move", async () => {
			await openUpNext();
			let writes = 0;
			onTestFinished(queue.subscribe(() => writes++));
			writes = 0;

			await fireEvent.keyDown(button(/^Reorder One,/), { key: "ArrowDown" });
			await fireEvent.keyDown(button(/^Reorder One,/), { key: "ArrowDown" });

			expect(listed()).toEqual(["Two", "Three", "One"]);
			expect(get(queue).episodes.map(({ title }) => title)).toEqual(["Two", "Three", "One"]);
			expect(writes).toBe(2);
		});

		/** Lays the panel's rows out 40 px apart, as the browser would, for a pointer to cross. */
		function layOutRows() {
			const rows = [
				...screen
					.getByRole("list", { name: "Queue" })
					.querySelectorAll<HTMLElement>(".pn-ep"),
			];
			for (const [index, row] of rows.entries()) {
				row.getBoundingClientRect = () =>
					({ top: index * 40, bottom: index * 40 + 40, left: 0, right: 300 }) as DOMRect;
			}
			document.elementFromPoint = (_x, y) =>
				rows[Math.floor(y / 40)]?.querySelector(".pn-ep-title") ?? document.body;
			onTestFinished(() => {
				Reflect.deleteProperty(document, "elementFromPoint");
			});
		}

		test("a drag across two rows writes the queue once, on release", async () => {
			await openUpNext();
			let writes = 0;
			onTestFinished(queue.subscribe(() => writes++));
			writes = 0;
			const at = (clientY: number) => ({ pointerId: 1, buttons: 1, clientX: 150, clientY });

			layOutRows();
			await fireEvent.pointerDown(button(/^Reorder One,/), { ...at(20), button: 0 });
			await fireEvent.pointerMove(window, at(70));
			layOutRows();
			await fireEvent.pointerMove(window, at(110));
			expect(listed()).toEqual(["Two", "Three", "One"]);
			expect(writes).toBe(0);
			await fireEvent.pointerUp(window, at(110));

			expect(get(queue).episodes.map(({ title }) => title)).toEqual(["Two", "Three", "One"]);
			expect(writes).toBe(1);
		});

		test("Escape during a drag cancels the drag, writing nothing, and keeps the player open", async () => {
			await openUpNext();
			const before = get(queue);

			await fireEvent.pointerDown(button(/^Reorder One,/), { button: 0, pointerId: 1 });
			press("Escape");
			await fireEvent.pointerUp(window, { pointerId: 1 });

			expect(get(queue)).toBe(before);
			expect(services.navigation.current.expanded).toBe(true);
			press("Escape");
			expect(services.navigation.current.expanded).toBe(false);
		});
	});
});
