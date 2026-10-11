// @vitest-environment jsdom
import { render, screen } from "@testing-library/svelte";
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
		],
	});

	expect(screen.getAllByText("Rerun")).toHaveLength(3);
});
