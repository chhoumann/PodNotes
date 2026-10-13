// @vitest-environment jsdom
import { App, FuzzySuggestModal, TFile } from "obsidian";
import { afterEach, expect, test, vi } from "vitest";
import { playLocalFile } from "src/playLocalFile";
import { pickVaultMedia } from "./pickVaultMedia";

vi.mock("src/playLocalFile", () => ({ playLocalFile: vi.fn(async () => {}) }));

afterEach(() => vi.restoreAllMocks());

function openOver(paths: string[]) {
	const app = Object.assign(new App(), {
		vault: { getFiles: () => paths.map((path) => Object.assign(new TFile(), { path })) },
	});
	const open = vi.spyOn(FuzzySuggestModal.prototype, "open").mockImplementation(() => {});
	pickVaultMedia(app as never);
	const modal = open.mock.contexts[0] as unknown as FuzzySuggestModal<TFile>;
	return { app, modal };
}

test("lists the vault's audio and video files, by path", () => {
	const { modal } = openOver(["Talks/a.mp3", "Notes/a.md", "Clips/b.mp4", "c.png"]);

	expect(modal.getItems().map((file) => modal.getItemText(file))).toEqual([
		"Talks/a.mp3",
		"Clips/b.mp4",
	]);
});

test("plays the chosen file as audio or video", () => {
	const { app, modal } = openOver(["Talks/a.mp3", "Clips/b.mp4"]);
	const [audio, video] = modal.getItems();

	modal.onChooseItem(audio, new MouseEvent("click"));
	modal.onChooseItem(video, new MouseEvent("click"));

	expect(vi.mocked(playLocalFile).mock.calls).toEqual([
		[app, audio, "audio"],
		[app, video, "video"],
	]);
});
