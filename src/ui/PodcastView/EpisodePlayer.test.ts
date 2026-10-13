// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { MenuItem } from "obsidian";
import { tick } from "svelte";
import { derived, get, writable } from "svelte/store";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DEFAULT_SETTINGS } from "src/constants";
import type { PlayerState } from "src/player/PlayerController";
import { plugin, queue } from "src/store";
import type { Episode } from "src/types/Episode";
import { pluginLibrary } from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import EpisodePlayer from "./EpisodePlayer.svelte";
import { Navigation } from "./Navigation";

const episode: Episode = {
	title: "Current Episode",
	streamUrl: "https://pod.example.com/audio.mp3",
	url: "https://pod.example.com/episode",
	description: "",
	content: "",
	podcastName: "Test Podcast",
};

/** The view over a player whose state the test sets, recording the intents it receives. */
function renderPlayer(patch: Partial<PlayerState> = {}, target = document.body) {
	const state = writable<PlayerState>({
		status: "playing",
		episode,
		mediaType: "audio",
		currentTime: 0,
		duration: 3600,
		playbackRate: 1,
		volume: 1,
		...patch,
	});
	const player = {
		state,
		play: vi.fn(),
		seek: vi.fn(),
		toggle: vi.fn(),
		setVolume: vi.fn(),
		setPlaybackRate: vi.fn(),
		videoStage: vi.fn(() => ({ destroy: vi.fn() })),
	};
	const services = {
		settings: derived(plugin, ($plugin) => $plugin.settings),
		api: { skipBackward: vi.fn(), skipForward: vi.fn() },
		player,
		navigation: new Navigation(),
		// A queued episode's menu reads the plugin's queue, so the player shows that one.
		library: pluginLibrary,
		hasNote: () => false,
	} as never;
	return {
		...render(WithServices, { target, props: { services, component: EpisodePlayer } }),
		state,
		player,
	};
}

const labels = (container: HTMLElement) =>
	Array.from(container.querySelectorAll(".status-container span")).map((s) => s.textContent);
const barWidth = (container: HTMLElement) =>
	(container.querySelector(".progress__bar") as HTMLElement).style.width;

beforeEach(() => {
	queue.set({ ...structuredClone(DEFAULT_SETTINGS.queue), episodes: [] });
	plugin.set({ settings: structuredClone(DEFAULT_SETTINGS) } as never);
});

describe("EpisodePlayer", () => {
	test("holds no media element: playback outlives the view", () => {
		const { container } = renderPlayer();

		expect(container.querySelector("audio, video")).toBeNull();
	});

	test("shows a spinner while loading, then an error instead when the media fails", async () => {
		const { container, state } = renderPlayer({ status: "loading" });
		expect(container.querySelector(".podcast-artwork-isloading-overlay")).not.toBeNull();

		state.update((s) => ({ ...s, status: "error" }));
		await Promise.resolve();

		expect(container.querySelector(".podcast-artwork-isloading-overlay")).toBeNull();
		expect(container.querySelector(".podcast-artwork-load-error")?.textContent).toContain(
			"Could not load this episode's media.",
		);
	});

	test("shows a restored episode paused at its saved position", () => {
		const { container } = renderPlayer({
			status: "restored",
			currentTime: 1800,
			duration: 3600,
		});

		expect(labels(container)).toEqual(["00:30:00", "00:30:00"]);
		expect(barWidth(container)).toBe("50%");
		expect(container.querySelector(".podcast-artwork-overlay.visible")).not.toBeNull();
		expect(container.querySelector(".podcast-artwork-isloading-overlay")).toBeNull();
	});

	test("clicking the artwork toggles playback", async () => {
		const { container, player } = renderPlayer();

		await fireEvent.click(container.querySelector(".hover-container") as HTMLElement);

		expect(player.toggle).toHaveBeenCalledTimes(1);
	});

	test("the End key on the progress bar seeks to the end", async () => {
		const { container, player } = renderPlayer({ currentTime: 100, duration: 3600 });

		await fireEvent.keyDown(container.querySelector(".progress") as HTMLElement, {
			key: "End",
		});

		expect(player.seek).toHaveBeenCalledWith(3600);
	});

	test("the rate label shows the rate, and its slider sets it", async () => {
		const { container, player } = renderPlayer({ playbackRate: 1.7 });

		expect(container.querySelector(".playbackrate-container span")?.textContent).toBe("1.7x");
		const slider = container.querySelector(".playbackrate-container input") as HTMLInputElement;
		await fireEvent.input(slider, { target: { value: "2.2" } });

		expect(player.setPlaybackRate).toHaveBeenCalledWith(2.2);
	});

	test("the volume label shows the volume, and its slider sets it", async () => {
		const { container, player } = renderPlayer({ volume: 0.4 });

		expect(container.querySelector(".volume-container span")?.textContent).toBe("Volume: 40%");
		const slider = container.querySelector(".volume-container input") as HTMLInputElement;
		await fireEvent.input(slider, { target: { value: "0.65" } });

		expect(player.setVolume).toHaveBeenCalledWith(0.65);
	});

	test("clicking a queued episode plays it", async () => {
		const queued = { ...episode, title: "Queued Episode" };
		queue.set({ ...get(queue), episodes: [queued] });
		const { player } = renderPlayer();

		await fireEvent.click(screen.getByText("Queued Episode"));

		expect(player.play).toHaveBeenCalledWith(queued);
	});

	test("a queued episode's menu can move it in the queue", async () => {
		const first = { ...episode, title: "First Queued" };
		const second = { ...episode, title: "Second Queued" };
		queue.set({ ...get(queue), episodes: [first, second] });
		plugin.set({
			app: { vault: { getAbstractFileByPath: () => null } },
			settings: structuredClone(DEFAULT_SETTINGS),
		} as never);
		const titles = vi.spyOn(MenuItem.prototype, "setTitle");
		renderPlayer();

		await fireEvent.contextMenu(screen.getByText("Second Queued"));

		expect(titles.mock.calls.map(([title]) => title)).toContain("Move up in queue");
		titles.mockRestore();
	});

	test("an empty Queue follows queue automation as settings change or are imported (#108)", async () => {
		const host = get(plugin);
		renderPlayer();
		expect(screen.getByRole("heading", { name: "Queue" })).toBeInTheDocument();

		host.settings.autoQueue = false;
		plugin.set(host);
		await tick();
		expect(screen.queryByRole("heading", { name: "Queue" })).toBeNull();

		host.settings = { ...structuredClone(DEFAULT_SETTINGS), autoQueue: true };
		plugin.set(host);
		await tick();
		expect(screen.getByRole("heading", { name: "Queue" })).toBeInTheDocument();
	});

	test("a video episode in a popout shows its artwork, since the video plays in the main window", async () => {
		const popout = document.body.appendChild(document.createElement("iframe"));
		const { container, player } = renderPlayer(
			{ mediaType: "video", status: "paused" },
			popout.contentDocument?.body,
		);
		await Promise.resolve();

		expect(container.querySelector(".episode-video-container")).toBeNull();
		expect(container.querySelector(".podcast-video-fullscreen")).toBeNull();
		await fireEvent.click(container.querySelector(".hover-container") as HTMLElement);
		expect(player.toggle).toHaveBeenCalledTimes(1);
		popout.remove();
	});

	test("a video episode gives the player a stage for its video", async () => {
		const { container, player } = renderPlayer({ mediaType: "video", status: "paused" });
		const stage = container.querySelector(".episode-video-container");

		expect(player.videoStage).toHaveBeenCalledWith(stage);
		await fireEvent.click(container.querySelector(".podcast-video-overlay") as HTMLElement);
		expect(player.toggle).toHaveBeenCalledTimes(1);
	});
});
