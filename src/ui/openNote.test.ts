import { describe, expect, test } from "vitest";
import { ItemView, TFile, type App } from "obsidian";
import { VIEW_TYPE } from "src/constants";
import { openNote } from "./openNote";

type Group = { readonly stacked: boolean };

interface FakeLeaf {
	readonly name: string;
	readonly parent: Group;
	readonly view: ItemView & { navigation: boolean };
	readonly opened: string[];
	getRoot(): object;
	getContainer(): object;
	getViewState(): { type: string; pinned: boolean };
	openFile(file: TFile): Promise<void>;
}

const mainArea = {};
const mainWindow = {};

function leaf(name: string, parent: Group, type = "markdown", pinned = false): FakeLeaf {
	const view = Object.assign(Object.create(ItemView.prototype) as ItemView, {
		navigation: type !== VIEW_TYPE,
		getViewType: () => type,
		// A stacked group shows every tab side by side, scrolled or not.
		containerEl: { isShown: () => true },
	});
	const opened: string[] = [];
	return {
		name,
		parent,
		view,
		opened,
		getRoot: () => mainArea,
		getContainer: () => mainWindow,
		getViewState: () => ({ type, pinned }),
		openFile: async (file) => void opened.push(file.path),
	};
}

/**
 * A desktop main area with the PodNotes view active. `recent` is the note Obsidian's
 * getLeaf(false) returns: in a stacked group every tab counts, and it takes the one active last.
 */
function workspace(leaves: FakeLeaf[], recent: FakeLeaf) {
	const view = leaves.find((each) => each.view.getViewType() === VIEW_TYPE)!;
	const splits: FakeLeaf[] = [];
	const app = {
		workspace: {
			leftSplit: {},
			rightSplit: {},
			getActiveViewOfType: (type: typeof ItemView) =>
				view.view instanceof type ? Object.assign(view.view, { leaf: view }) : null,
			iterateAllLeaves: (callback: (each: FakeLeaf) => void) => leaves.forEach(callback),
			getLeaf: () => recent,
			createLeafBySplit: (target: FakeLeaf) => {
				const split = leaf(`split beside ${target.name}`, { stacked: false });
				splits.push(split);
				return split;
			},
		},
	} as unknown as App;
	return { app, splits };
}

const note = Object.assign(new TFile(), { path: "Transcripts/Episode.md" });

describe("a note PodNotes opens while its view is stacked with notes", () => {
	test("goes to a split beside the view, not to a note stacked with it", async () => {
		const stack = { stacked: true };
		const stacked = leaf("stacked note", stack);
		const { app, splits } = workspace([stacked, leaf("view", stack, VIEW_TYPE)], stacked);

		await openNote(app, note);

		expect(stacked.opened).toEqual([]);
		expect(splits.map((split) => [split.name, split.opened])).toEqual([
			["split beside view", [note.path]],
		]);
	});

	test("goes to a note in another tab group, even when a stacked one was active last", async () => {
		const stack = { stacked: true };
		const stacked = leaf("stacked note", stack);
		const beside = leaf("note beside", { stacked: false });
		const { app, splits } = workspace(
			[stacked, leaf("view", stack, VIEW_TYPE), beside],
			stacked,
		);

		await openNote(app, note);

		expect([stacked.opened, beside.opened, splits]).toEqual([[], [note.path], []]);
	});
});

test("a note PodNotes opens goes to a split beside the view, not to a pinned note beside it", async () => {
	const tabs = { stacked: false };
	const pinned = leaf("pinned note", { stacked: false }, "markdown", true);
	// Obsidian passes over a pinned note and adds a tab to the view's group.
	const { app, splits } = workspace(
		[leaf("view", tabs, VIEW_TYPE), pinned],
		leaf("new tab over the view", tabs),
	);

	await openNote(app, note);

	expect(pinned.opened).toEqual([]);
	expect(splits.map((split) => [split.name, split.opened])).toEqual([
		["split beside view", [note.path]],
	]);
});
