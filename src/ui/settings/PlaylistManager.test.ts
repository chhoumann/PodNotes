import { render } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";

import PlaylistManager from "./PlaylistManager.svelte";

describe("PlaylistManager", () => {
	// Regression test for the #109-class icon-only button: the add-playlist
	// control previously used an icon-only "+" Button with no text and no
	// aria-label, so on iPad it rendered as an empty box and was invisible to
	// screen readers. It must carry a visible text label and an accessible name.
	test("renders a labelled, accessible 'Add' playlist button", () => {
		const { getByRole } = render(PlaylistManager);

		const addButton = getByRole("button", { name: "Add playlist" });

		expect(addButton).toBeInTheDocument();
		expect(addButton.textContent?.trim()).toBe("Add");
		expect(addButton.classList.contains("mod-cta")).toBe(true);
	});
});
