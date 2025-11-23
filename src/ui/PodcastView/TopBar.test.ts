import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";

import { ViewState } from "src/types/ViewState";
import TopBar from "./TopBar.svelte";

describe("TopBar", () => {
	test("matches snapshot for default state", () => {
		const { container } = render(TopBar, {
			props: {
				viewState: ViewState.PodcastGrid,
				canShowEpisodeList: true,
				canShowPlayer: false,
			},
		});

		expect(container.firstChild).toMatchSnapshot();
	});

	test("activates episode list when clicked", async () => {
		const { getByLabelText } = render(TopBar, {
			props: {
				viewState: ViewState.PodcastGrid,
				canShowEpisodeList: true,
				canShowPlayer: false,
			},
		});

		const episodeButton = getByLabelText("Episode list");
		const playerButton = getByLabelText("Player");

		await fireEvent.click(episodeButton);

		expect(episodeButton.className).toContain("topbar-selected");
		expect(playerButton.className).not.toContain("topbar-selected");
	});

	test("keeps controls unfocusable when view is unavailable", () => {
		const { getByLabelText } = render(TopBar, {
			props: {
				viewState: ViewState.PodcastGrid,
				canShowEpisodeList: false,
				canShowPlayer: false,
			},
		});

		const episodeButton = getByLabelText("Episode list");
		const playerButton = getByLabelText("Player");

		expect(episodeButton).toHaveAttribute("tabindex", "-1");
		expect(playerButton).toHaveAttribute("tabindex", "-1");
		expect(episodeButton.className).not.toContain("topbar-selectable");
	});

	test("responds to keyboard activation for player control", async () => {
		const { getByLabelText } = render(TopBar, {
			props: {
				viewState: ViewState.EpisodeList,
				canShowEpisodeList: true,
				canShowPlayer: true,
			},
		});

		const playerButton = getByLabelText("Player");

		await fireEvent.keyDown(playerButton, { key: "Enter" });

		expect(playerButton.className).toContain("topbar-selected");
	});
});
