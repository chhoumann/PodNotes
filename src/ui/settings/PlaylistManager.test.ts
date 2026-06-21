import { fireEvent, render } from "@testing-library/svelte";
import { get } from "svelte/store";
import * as obsidian from "obsidian";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { playlists } from "src/store";
import PlaylistManager from "./PlaylistManager.svelte";

function typeName(input: HTMLInputElement, value: string) {
	input.value = value;
	return fireEvent.input(input);
}

describe("PlaylistManager", () => {
	beforeEach(() => {
		playlists.set({});
		vi.restoreAllMocks();
	});

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

	// PL-01: a non-empty, non-duplicate name is added to the store and the
	// input is cleared on success.
	test("adds a playlist with the trimmed name as both key and name", async () => {
		const { getByRole, getByPlaceholderText } = render(PlaylistManager);
		const input = getByPlaceholderText("Playlist name") as HTMLInputElement;

		await typeName(input, "  My Shows  ");
		await fireEvent.click(getByRole("button", { name: "Add playlist" }));

		const stored = get(playlists);
		expect(Object.keys(stored)).toEqual(["My Shows"]);
		expect(stored["My Shows"].name).toBe("My Shows");
		expect(input.value).toBe("");
	});

	// PL-01 + MX-03: an empty/whitespace-only name is rejected with a Notice,
	// nothing is added, and the input is left intact so the user can correct it.
	test("rejects an empty name with a Notice and adds nothing", async () => {
		const noticeSpy = vi.spyOn(obsidian, "Notice");
		const { getByRole, getByPlaceholderText } = render(PlaylistManager);
		const input = getByPlaceholderText("Playlist name") as HTMLInputElement;

		await typeName(input, "   ");
		await fireEvent.click(getByRole("button", { name: "Add playlist" }));

		expect(get(playlists)).toEqual({});
		expect(noticeSpy).toHaveBeenCalledWith("Playlist name cannot be empty.");
		expect(input.value).toBe("   ");
	});

	// MX-03: adding a playlist whose trimmed name already exists must NOT
	// overwrite the existing one (silent data loss). It is rejected with a
	// Notice and the original playlist is preserved.
	test("rejects a duplicate name without overwriting the existing playlist", async () => {
		const existing = {
			name: "Favorites Mix",
			icon: "list" as const,
			episodes: [],
			shouldEpisodeRemoveAfterPlay: false,
			shouldRepeat: false,
		};
		playlists.set({ "Favorites Mix": existing });

		const noticeSpy = vi.spyOn(obsidian, "Notice");
		const { getByRole, getByPlaceholderText } = render(PlaylistManager);
		const input = getByPlaceholderText("Playlist name") as HTMLInputElement;

		await typeName(input, "Favorites Mix");
		await fireEvent.click(getByRole("button", { name: "Add playlist" }));

		const stored = get(playlists);
		expect(Object.keys(stored)).toEqual(["Favorites Mix"]);
		expect(stored["Favorites Mix"]).toBe(existing);
		expect(noticeSpy).toHaveBeenCalledWith(
			"A playlist with that name already exists.",
		);
		// The duplicate name was rejected, so the input is left for correction.
		expect(input.value).toBe("Favorites Mix");
	});

	// MX-03: a trimmed name that collides with an existing key after trimming is
	// still treated as a duplicate.
	test("treats a name as duplicate after trimming", async () => {
		const existing = {
			name: "Daily",
			icon: "list" as const,
			episodes: [],
			shouldEpisodeRemoveAfterPlay: false,
			shouldRepeat: false,
		};
		playlists.set({ Daily: existing });

		const noticeSpy = vi.spyOn(obsidian, "Notice");
		const { getByRole, getByPlaceholderText } = render(PlaylistManager);
		const input = getByPlaceholderText("Playlist name") as HTMLInputElement;

		await typeName(input, "  Daily ");
		await fireEvent.click(getByRole("button", { name: "Add playlist" }));

		expect(Object.keys(get(playlists))).toEqual(["Daily"]);
		expect(noticeSpy).toHaveBeenCalledWith(
			"A playlist with that name already exists.",
		);
	});
});
