import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";

import { ViewState } from "src/types/ViewState";
import TopBar from "./TopBar.svelte";

describe("TopBar", () => {
	test("renders default controls with correct accessibility state", () => {
		const { getByLabelText } = render(TopBar, {
			props: {
				viewState: ViewState.PodcastGrid,
				canShowEpisodeList: true,
				canShowPlayer: false,
			},
		});

		const grid = getByLabelText("Podcast grid");
		const episode = getByLabelText(/Episode list/);
		const player = getByLabelText(/Player/);

		expect(grid.className).toContain("topbar-selected");
		expect(episode.className).toContain("topbar-selectable");
		expect(episode).not.toBeDisabled();
		expect(player).toBeDisabled();
		expect(player.className).not.toContain("topbar-selectable");
		expect(player.className).toContain("topbar-disabled");
		expect(player.getAttribute("title")).toBe(
			"Start playing an episode to open the player."
		);
		expect(episode.getAttribute("title")).toBe("View episode list");
	});

	test("activates episode list when clicked", async () => {
		const { getByLabelText } = render(TopBar, {
			props: {
				viewState: ViewState.PodcastGrid,
				canShowEpisodeList: true,
				canShowPlayer: false,
			},
		});

		const episodeButton = getByLabelText(/Episode list/);
		const playerButton = getByLabelText(/Player/);

		await fireEvent.click(episodeButton);

		expect(episodeButton.className).toContain("topbar-selected");
		expect(playerButton.className).not.toContain("topbar-selected");
	});

	test("keeps controls disabled when view is unavailable", () => {
		const { getByLabelText } = render(TopBar, {
			props: {
				viewState: ViewState.PodcastGrid,
				canShowEpisodeList: false,
				canShowPlayer: false,
			},
		});

		const episodeButton = getByLabelText(/Episode list/);
		const playerButton = getByLabelText(/Player/);

		expect(episodeButton).toBeDisabled();
		expect(playerButton).toBeDisabled();
		expect(episodeButton.className).not.toContain("topbar-selectable");
		expect(episodeButton.className).toContain("topbar-disabled");
		expect(playerButton.className).toContain("topbar-disabled");
		expect(episodeButton.getAttribute("title")).toBe(
			"Select a podcast or playlist to view its episodes."
		);
		expect(playerButton.getAttribute("title")).toBe(
			"Start playing an episode to open the player."
		);
	});

	test("activates player control when clicked", async () => {
		const { getByLabelText } = render(TopBar, {
			props: {
				viewState: ViewState.EpisodeList,
				canShowEpisodeList: true,
				canShowPlayer: true,
			},
		});

		const playerButton = getByLabelText(/Player/);

		await fireEvent.click(playerButton);

		expect(playerButton.className).toContain("topbar-selected");
	});
});
