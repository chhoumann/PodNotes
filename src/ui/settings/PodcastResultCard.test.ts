import { render } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";

import type { PodcastFeed } from "src/types/PodcastFeed";
import PodcastResultCard from "./PodcastResultCard.svelte";

const podcast: PodcastFeed = {
	title: "How I Built This",
	url: "https://example.com/feed.xml",
	artworkUrl: "https://example.com/artwork.jpg",
};

// Regression tests for #109: on iPad the icon-only "+"/trash button rendered as
// an empty box, so users could not find the add control. The action must always
// carry a visible text label (never an icon glyph alone) and read as a clear,
// enabled call to action.
describe("PodcastResultCard", () => {
	test("renders a visible, enabled 'Add' call-to-action when not saved", () => {
		const { getByRole } = render(PodcastResultCard, {
			props: { podcast, isSaved: false },
		});

		const addButton = getByRole("button", {
			name: `Add ${podcast.title} podcast`,
		});

		expect(addButton).toBeInTheDocument();
		expect(addButton.textContent?.trim()).toBe("Add");
		expect(addButton).not.toBeDisabled();
		// Accent-styled so it stands out as the primary action.
		expect(addButton.classList.contains("mod-cta")).toBe(true);
	});

	test("renders a visible 'Remove' control when the podcast is saved", () => {
		const { getByRole } = render(PodcastResultCard, {
			props: { podcast, isSaved: true },
		});

		const removeButton = getByRole("button", {
			name: `Remove ${podcast.title} podcast`,
		});

		expect(removeButton).toBeInTheDocument();
		expect(removeButton.textContent?.trim()).toBe("Remove");
		expect(removeButton).not.toBeDisabled();
		expect(removeButton.classList.contains("mod-warning")).toBe(true);
	});

	test("never renders an action without a visible text label", () => {
		const { getByRole } = render(PodcastResultCard, {
			props: { podcast, isSaved: false },
		});

		// Guards the #109 root cause: an icon-only button leaves an empty,
		// unrecognisable tap target on touch platforms.
		const button = getByRole("button");
		expect(button.textContent?.trim().length ?? 0).toBeGreaterThan(0);
	});
});
