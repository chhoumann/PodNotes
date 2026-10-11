// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { expect, test } from "vitest";

import type { Episode } from "src/types/Episode";
import EpisodeList from "./EpisodeList.svelte";

const rerun = (streamUrl: string): Episode => ({
	title: "Rerun",
	streamUrl,
	url: streamUrl,
	description: "",
	content: "",
	podcastName: "Shared Show",
});

test("lists every episode, also two that share a podcast name and title", async () => {
	const view = render(EpisodeList, {
		episodes: [rerun("https://media.test/1.mp3"), rerun("https://media.test/2.mp3")],
	});
	expect(screen.getAllByText("Rerun")).toHaveLength(2);

	await view.rerender({
		episodes: [
			rerun("https://media.test/3.mp3"),
			rerun("https://media.test/2.mp3"),
			rerun("https://media.test/1.mp3"),
			{ ...rerun("https://media.test/4.mp3"), title: "Rerun#1" },
		],
	});

	expect(screen.getAllByText("Rerun")).toHaveLength(3);
	expect(screen.getByText("Rerun#1")).toBeTruthy();
});

test("an episode that stays listed keeps its loaded artwork when an earlier one leaves", async () => {
	const withArtwork = (title: string): Episode => ({
		...rerun(`https://media.test/${title}.mp3`),
		title,
		artworkUrl: `https://art.test/${title}.jpg`,
	});
	const view = render(EpisodeList, {
		episodes: [withArtwork("First"), withArtwork("Second")],
		showThumbnails: true,
	});
	await fireEvent.load(screen.getByAltText("Second"));
	expect(screen.getByAltText("Second").style.opacity).toBe("1");

	await view.rerender({ episodes: [withArtwork("Second")] });

	expect(screen.getByAltText("Second").style.opacity).toBe("1");
});
