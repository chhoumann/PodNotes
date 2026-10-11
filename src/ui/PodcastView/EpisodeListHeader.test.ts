// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { expect, test } from "vitest";

import EpisodeListHeader from "./EpisodeListHeader.svelte";

test("artwork that cannot load leaves the title without a broken image", async () => {
	const view = render(EpisodeListHeader, {
		text: "Art Show",
		artworkUrl: "https://art.test/missing.jpg",
	});

	await fireEvent.error(screen.getByAltText("Art Show"));

	expect(screen.queryByRole("img")).toBeNull();
	expect(screen.getByRole("heading", { name: "Art Show" })).toBeInTheDocument();

	await view.rerender({ artworkUrl: "https://art.test/new.jpg" });
	expect(screen.getByAltText("Art Show")).toHaveAttribute("src", "https://art.test/new.jpg");
});
