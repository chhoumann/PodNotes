// @vitest-environment jsdom
import type { Workspace } from "obsidian";
import type { UserConfig } from "vite";
import { afterEach, expect, test, vi } from "vitest";
import { openPopout } from "../../tests/mocks/popout";
import { removePreviousStyles } from "./removePreviousStyles";

vi.mock("@sveltejs/vite-plugin-svelte", () => ({
	svelte: (options: unknown) => ({ name: "svelte-options", options }),
}));

type CssHash = (input: { hash: (css: string) => string; css: string }) => string;

/** The id the production build gives the sheet of a component whose CSS hashes to `hash`. */
async function builtSheetId(hash: string): Promise<string> {
	const { default: config } = await import("../../vite.config");
	const resolved = (config as (env: object) => UserConfig)({
		mode: "production",
		command: "build",
	});
	const svelte = resolved.plugins?.find(
		(plugin) => plugin && "name" in plugin && plugin.name === "svelte-options",
	) as unknown as { options: { compilerOptions: { cssHash: CssHash } } };
	return svelte.options.compilerOptions.cssHash({ hash: () => hash, css: "" });
}

function addSheet(doc: Document, id: string): void {
	const style = doc.createElement("style");
	style.id = id;
	doc.head.append(style);
}

const sheetIds = (doc: Document) =>
	[...doc.head.querySelectorAll("style")].map((style) => style.id);

function workspaceWithLeavesIn(...docs: Document[]): Workspace {
	return {
		iterateAllLeaves: (callback: (leaf: unknown) => void) => {
			for (const doc of docs) callback({ getContainer: () => ({ doc }) });
		},
	} as unknown as Workspace;
}

afterEach(() => {
	document.head.replaceChildren();
});

test("removes the sheets of an earlier build from the main window and every popout, and no other sheet", async () => {
	const popout = openPopout().win.document;
	const earlier = await builtSheetId("earlier");
	for (const doc of [document, popout]) {
		addSheet(doc, earlier);
		addSheet(doc, "svelte-1x2y3z");
		addSheet(doc, "obsidian-theme");
	}

	removePreviousStyles(workspaceWithLeavesIn(document, popout, popout));

	expect(sheetIds(document)).toEqual(["svelte-1x2y3z", "obsidian-theme"]);
	expect(sheetIds(popout)).toEqual(["svelte-1x2y3z", "obsidian-theme"]);
});

test("removes the main window's sheets when no leaf is open", async () => {
	addSheet(document, await builtSheetId("earlier"));

	removePreviousStyles(workspaceWithLeavesIn());

	expect(sheetIds(document)).toEqual([]);
});
