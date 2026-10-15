import { describe, expect, onTestFinished, test } from "vitest";
import { createPodNotesE2EHarness } from "./harness";
import {
	clickInEditor,
	clickInNoteWindow,
	closePopoutTab,
	focusNoteWindow,
	openInEditor,
	reloadAfterPopout,
	runFromPalette,
	showLibrary,
	showPodNotes,
} from "./journey/actions";
import { startFixtureServer, type FixtureFeed } from "./journey/fixtures";
import { cdp, click, typeText } from "./journey/input";
import { readVaultText, seedLibrary, waitForPlayback, writeVaultFile } from "./journey/library";
import { ui } from "./journey/targets";
import { eventually, notices } from "./journey/wait";
import { jsLiteral } from "./runtime";
import type { IPodNotesSettings } from "../../src/types/IPodNotesSettings";

const getContext = createPodNotesE2EHarness("table-cell-capture");
const FEED: FixtureFeed = {
	title: "Table capture podcast",
	slug: "table-capture",
	artwork: false,
	episodes: [{ title: "Table episode", seconds: 60, guid: "table-episode" }],
};
const TABLE =
	"# Captures\n\n| Moment | Notes |\n| --- | --- |\n| Start | anchor |\n\nAfter table\n";

const WIDE_TABLE = TABLE.replace(
	"\n\nAfter table",
	`\n| Kept | ${"wide ".repeat(40)} |\n\nAfter table`,
);

async function setUp({
	content = TABLE,
	source = false,
	template = "{{time}} | cut\n",
} = {}): Promise<string> {
	const context = getContext();
	const { obsidian, plugin, sandbox } = context;
	const server = await startFixtureServer([FEED]);
	onTestFinished(() => server.stop());
	await seedLibrary(context, server, { subscriptions: [FEED] });
	await plugin.updateDataAndReload<IPodNotesSettings>((data) => {
		data.timestamp.template = template;
	});

	await showPodNotes(obsidian);
	await showLibrary(obsidian);
	await click(obsidian, ui.podcastCard(FEED.title));
	await click(obsidian, ui.episode("Table episode"));
	await waitForPlayback(obsidian, (state) => (state.media?.seconds ?? 0) > 0, "episode loaded");
	await click(obsidian, ui.playbackToggle);
	await waitForPlayback(obsidian, (state) => !state.playing, "episode paused");
	await obsidian.dev.evalJson("app.plugins.plugins.podnotes.api.currentTime = 30");
	const path = sandbox.path("Table captures.md");
	await writeVaultFile(obsidian, path, content);
	await openInEditor(obsidian, path);
	if (source) {
		await obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)});
			await leaf.setViewState({type:"markdown",state:{file:${jsLiteral(path)},mode:"source",source:true}});
			return true;
		})()`);
		expect(await clickInEditor(obsidian, path, 4, 16)).toEqual({ line: 4, ch: 16 });
		return path;
	}
	await click(obsidian, {
		name: "Notes table cell",
		elements: `[...app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view.containerEl.querySelectorAll(".markdown-source-view td")].filter((el) => el.textContent === "anchor")`,
	});
	await cdp(obsidian, "Input.dispatchKeyEvent", {
		type: "keyDown",
		key: "End",
		windowsVirtualKeyCode: 35,
	});
	await cdp(obsidian, "Input.dispatchKeyEvent", {
		type: "keyUp",
		key: "End",
		windowsVirtualKeyCode: 35,
	});
	expect(
		await obsidian.dev.evalJson<boolean>('Boolean(document.activeElement?.closest("td"))'),
		"the cell editor has focus",
	).toBe(true);
	return path;
}

const lastUndo = {
	name: "last capture Undo",
	elements: '[...document.querySelectorAll(".notice button.pn-undo")].slice(-1)',
};

async function cellText(path: string): Promise<string> {
	return await getContext().obsidian.dev.evalJson<string>(
		`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)})?.view.editor.editorComponent.tableCell.editor.getValue() ?? ""`,
	);
}

function rows(text: string): string[][] {
	return text
		.split("\n")
		.filter((line) => line.startsWith("|"))
		.map((line) =>
			line
				.split(/(?<!\\)\|/)
				.slice(1, -1)
				.map((cell) => cell.trim()),
		);
}

async function expectCell(path: string, cell: string): Promise<string> {
	const { obsidian } = getContext();
	const expected = ["Start", cell.trim()];
	expect(
		await eventually(
			obsidian,
			async () => rows(await readVaultText(obsidian, path)).at(-1),
			expected,
			10_000,
		),
		"persisted table cells",
	).toEqual(expected);
	const text = await readVaultText(obsidian, path);
	expect(rows(text)).toHaveLength(3);
	expect(rows(text)[0]).toEqual(["Moment", "Notes"]);
	expect(text).toMatch(/^# Captures\n\n/);
	expect(text).toMatch(/\n\nAfter table\n$/);
	return text;
}

describe("Live Preview table captures", () => {
	test("captures in the cell when the PodNotes leaf takes focus in the same evaluation", async () => {
		const { obsidian } = getContext();
		const path = await setUp();
		const result = await obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getLeavesOfType("podcast_player_view")[0];
			app.workspace.setActiveLeaf(leaf, { focus: true });
			const activeEditorNull = app.workspace.activeEditor === null;
			const capture = await app.plugins.plugins.podnotes.capture.timestamp();
			return { activeEditorNull, capture };
		})()`);

		expect(result).toEqual({
			activeEditorNull: true,
			capture: {
				destination: "editor",
				path,
				text: "00:00:30 \\| cut ",
				created: false,
			},
		});
		await expectCell(path, "anchor00:00:30 \\| cut ");
		expect(await cellText(path)).toBe("anchor00:00:30 | cut ");
	});

	test("#445 three captures persist in one cell and Undo removes only the last", async () => {
		const { obsidian } = getContext();
		const path = await setUp();
		await runFromPalette(obsidian, "Capture Timestamp");
		const first = "anchor00:00:30 \\| cut ";
		await expectCell(path, first);
		await obsidian.exec("command", { id: "podnotes:capture-segment-10s" });
		const second = `${first}00:00:20-00:00:30 \\| cut `;
		const beforeLast = await expectCell(path, second);
		await obsidian.exec("command", { id: "podnotes:capture-segment-20s" });
		await expectCell(path, `${second}00:00:10-00:00:30 \\| cut `);
		expect(await cellText(path)).toBe(
			"anchor00:00:30 | cut 00:00:20-00:00:30 | cut 00:00:10-00:00:30 | cut ",
		);
		await click(obsidian, lastUndo);
		expect(
			await eventually(obsidian, () => readVaultText(obsidian, path), beforeLast, 10_000),
			"Undo restores the exact saved note",
		).toBe(beforeLast);
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
		expect(
			await obsidian.dev.evalJson<string>(
				`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view.editor.getValue()`,
			),
		).toBe(beforeLast);
		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
		await expectCell(path, `${second}00:00:30 \\| cut `);
	}, 90_000);

	test("#445 player, mini player and headset capture into the last focused cell", async () => {
		const { obsidian } = getContext();
		await obsidian.dev.evalJson(`(() => {
			const session = navigator.mediaSession;
			const original = session.setActionHandler;
			const handlers = new Map();
			session.setActionHandler = function(action, handler) {
				handlers.set(action, handler);
				return original.call(this, action, handler);
			};
			window.__note2Media = { session, original, handlers };
			return true;
		})()`);
		onTestFinished(async () => {
			await obsidian.dev.evalJson(`(() => {
				const recorder = window.__note2Media;
				if (recorder) recorder.session.setActionHandler = recorder.original;
				delete window.__note2Media;
				return true;
			})()`);
		});
		const path = await setUp();
		await click(obsidian, ui.playerTimestamp);
		expect(
			await eventually(
				obsidian,
				() =>
					obsidian.dev.evalJson<string>(
						`(${ui.playerTimestamp.elements})[0].textContent.trim()`,
					),
				"Added",
				2000,
			),
		).toBe("Added");
		const first = "anchor00:00:30 \\| cut ";
		await expectCell(path, first);
		await click(obsidian, ui.collapsePlayer);
		await click(obsidian, ui.miniCapture);
		const second = `${first}00:00:30 \\| cut `;
		await expectCell(path, second);
		await obsidian.dev.evalJson(`(() => {
			const handler = window.__note2Media.handlers.get("previoustrack");
			if (!handler) throw new Error("The headset capture handler is not installed");
			handler({ action: "previoustrack" });
			return true;
		})()`);
		await expectCell(path, `${second}00:00:30 \\| cut `);
		await click(obsidian, lastUndo);
		await expectCell(path, second);
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
	}, 90_000);

	test("#445 Undo refuses after a different table cell changes", async () => {
		const { obsidian } = getContext();
		const path = await setUp();
		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
		await expectCell(path, "anchor00:00:30 \\| cut ");
		await click(obsidian, {
			name: "Moment table cell",
			elements: `[...app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view.containerEl.querySelectorAll(".markdown-source-view td")].filter((el) => el.textContent === "Start")`,
		});
		await typeText(obsidian, "edited");
		const edited = await obsidian.dev.evalJson<string>(
			"app.workspace.activeEditor.editor.getValue()",
		);
		await click(obsidian, lastUndo);
		expect(
			await eventually(obsidian, () => readVaultText(obsidian, path), edited, 10_000),
		).toBe(edited);
		expect(await notices(obsidian)).toContain(
			"The note isn't as the capture left it, so the timestamp stays",
		);
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
	}, 90_000);

	test("#445 Undo restores a capture inside a cell without changing the table width", async () => {
		const { obsidian } = getContext();
		const path = await setUp({ content: WIDE_TABLE });
		const before = await obsidian.dev.evalJson<string>(
			"app.workspace.activeEditor.editor.getValue()",
		);
		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
		expect(
			await eventually(
				obsidian,
				async () => rows(await readVaultText(obsidian, path))[2],
				["Start", "anchor00:00:30 \\| cut"],
				10_000,
			),
		).toEqual(["Start", "anchor00:00:30 \\| cut"]);
		await click(obsidian, lastUndo);
		expect(
			await eventually(obsidian, () => readVaultText(obsidian, path), before, 10_000),
			"the entire note is restored including cell padding",
		).toBe(before);
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
	}, 90_000);

	test("#445 table captures preserve existing pipe escape parity", async () => {
		const { obsidian } = getContext();
		const path = await setUp({ template: "{{time}} | a \\| b \\\\| c\n" });
		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
		await expectCell(path, "anchor00:00:30 \\| a \\| b \\\\\\| c ");
		expect(await cellText(path)).toBe("anchor00:00:30 | a | b \\\\| c ");
	});

	test("#445 leaving a cell preserves paragraph pipes, newlines and Undo", async () => {
		const { obsidian } = getContext();
		const path = await setUp();
		await clickInEditor(obsidian, path, 6, 11);
		const before = await obsidian.dev.evalJson<string>(
			`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view.editor.getValue()`,
		);
		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
		const expected = before.replace("After table", "After table00:00:30 | cut\n");
		expect(
			await eventually(obsidian, () => readVaultText(obsidian, path), expected, 10_000),
		).toBe(expected);
		await click(obsidian, lastUndo);
		expect(
			await eventually(obsidian, () => readVaultText(obsidian, path), before, 10_000),
		).toBe(before);
	});

	test.each(["split", "closed"])(
		"#445 Undo restores the exact note with its captured tab %s",
		async (state) => {
			const { obsidian } = getContext();
			const path = await setUp();
			const before = await obsidian.dev.evalJson<string>(
				`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view.editor.getValue()`,
			);
			await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
			await expectCell(path, "anchor00:00:30 \\| cut ");
			await obsidian.dev.evalJsonAsync(`(async () => {
			const leaf = app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)});
			if (${jsLiteral(state)} === "closed") leaf.detach();
			else await app.workspace.getLeaf("split").openFile(leaf.view.file);
			return true;
		})()`);
			await click(obsidian, lastUndo);
			expect(
				await eventually(obsidian, () => readVaultText(obsidian, path), before, 10_000),
			).toBe(before);
		},
	);

	test("#445 Undo restores both editors when the captured cell is in the second pane", async () => {
		const { obsidian } = getContext();
		const path = await setUp({ content: WIDE_TABLE });
		await clickInEditor(obsidian, path, 7, 11);
		await obsidian.dev.evalJsonAsync(`(async () => {
			const file = app.vault.getAbstractFileByPath(${jsLiteral(path)});
			await app.workspace.getLeaf("split").openFile(file);
			return true;
		})()`);
		const views = `app.workspace.getLeavesOfType("markdown").filter((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).map((leaf) => leaf.view)`;
		await click(obsidian, {
			name: "second pane's Notes cell",
			elements: `[...(${views}).at(-1).containerEl.querySelectorAll(".markdown-source-view td")].filter((el) => el.textContent === "anchor")`,
		});
		expect(
			await obsidian.dev.evalJson(
				`${views}.map((view) => Boolean(view.editor.editorComponent.tableCell))`,
			),
		).toEqual([false, true]);
		const before = await obsidian.dev.evalJson<string>(`(${views})[0].editor.getValue()`);
		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
		expect(
			await eventually(
				obsidian,
				async () =>
					rows(await readVaultText(obsidian, path))[2][1].includes("00:00:30 \\| cut"),
				true,
				10_000,
			),
		).toBe(true);
		await click(obsidian, lastUndo);
		expect(
			await eventually(obsidian, () => readVaultText(obsidian, path), before, 10_000),
		).toBe(before);
		expect(
			await obsidian.dev.evalJson(`${views}.map((view) => view.editor.getValue())`),
		).toEqual([before, before]);
	});

	test.each(["Source mode", "the tab showed another note"])(
		"#473 a capture after %s and a change made elsewhere keeps the table and its Undo",
		async (away) => {
			const { obsidian, sandbox } = getContext();
			const table =
				"# Captures\n\n| Moment | Notes  |\n| ------ | ------ |\n| Start  | anchor |\n| Later  | other  |\n\nAfter table\n";
			const path = await setUp({ content: table });
			const view = `app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view`;
			const changeElsewhere = `app.vault.process(app.vault.getAbstractFileByPath(${jsLiteral(path)}), (text) => text.replace("| other  |", "| other, edited elsewhere |"))`;
			if (away === "Source mode") {
				await obsidian.exec("command", { id: "editor:toggle-source" });
				await obsidian.dev.evalJsonAsync(`${changeElsewhere}.then(() => true)`);
			} else {
				const elsewhere = sandbox.path("Elsewhere.md");
				await writeVaultFile(obsidian, elsewhere, "Elsewhere\n");
				await obsidian.dev.evalJsonAsync(`(async () => {
					await ${view}.leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(elsewhere)}));
					await ${changeElsewhere};
					return true;
				})()`);
				await obsidian.exec("command", { id: "app:go-back" });
			}
			const before = table.replace("| other  |", "| other, edited elsewhere |");
			expect(
				await eventually(
					obsidian,
					() => obsidian.dev.evalJson<string>(`${view}.editor.getValue()`),
					before,
					10_000,
				),
			).toBe(before);
			expect(
				await obsidian.dev.evalJson(
					`${view}.editor.editorComponent.tableCell?.containerEl.isConnected ?? null`,
				),
				"Obsidian still holds a cell no longer in the document",
			).toBe(false);

			await obsidian.exec("command", { id: "podnotes:capture-timestamp" });

			const captured = before.replace("anchor", "anchor00:00:30 \\| cut ");
			expect(
				await eventually(obsidian, () => readVaultText(obsidian, path), captured, 10_000),
			).toBe(captured);
			await click(obsidian, lastUndo);
			expect(
				await eventually(obsidian, () => readVaultText(obsidian, path), before, 10_000),
			).toBe(before);
			expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
		},
		90_000,
	);

	test("#473 a capture into a cell of a note in a background tab keeps that cell open", async () => {
		const { obsidian } = getContext();
		const path = await setUp();
		await obsidian.exec("command", { id: "workspace:new-tab" });
		expect(
			await obsidian.dev.evalJson(`(() => {
				const cell = app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view.editor.editorComponent.tableCell;
				return { attached: cell.containerEl.isConnected, shown: cell.containerEl.isShown() };
			})()`),
			"the cell is in the document but not on screen",
		).toEqual({ attached: true, shown: false });

		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });

		await expectCell(path, "anchor00:00:30 \\| cut ");
		expect(await cellText(path)).toBe("anchor00:00:30 | cut ");
	});

	test("#473 Undo puts the note back after a cell of another note in its tab went stale", async () => {
		const { obsidian, sandbox } = getContext();
		const wide = sandbox.path("Wide header.md");
		const header = Array(80).fill("wide").join(" ");
		await writeVaultFile(obsidian, wide, `| ${header} |\n| --- |\n| x |\n`);
		const path = await setUp();
		const view = (file: string) =>
			`app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(file)})?.view`;
		const before = await obsidian.dev.evalJson<string>(`${view(path)}.editor.getValue()`);
		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
		const captured = await obsidian.dev.evalJson<string>(`${view(path)}.editor.getValue()`);
		await obsidian.dev.evalJsonAsync(`(async () => {
			await ${view(path)}.leaf.openFile(app.vault.getAbstractFileByPath(${jsLiteral(wide)}));
			return true;
		})()`);
		await click(obsidian, {
			name: "wide header cell",
			elements: `[...${view(wide)}.containerEl.querySelectorAll(".markdown-source-view th")]`,
		});
		await obsidian.exec("command", { id: "app:go-back" });
		expect(
			await eventually(
				obsidian,
				() => obsidian.dev.evalJson<string>(`${view(path)}.editor.getValue()`),
				captured,
				5000,
			),
		).toBe(captured);
		expect(
			await obsidian.dev.evalJson(`(() => {
				const cell = ${view(path)}.editor.editorComponent.tableCell;
				return { attached: cell.containerEl.isConnected, text: cell.editor.getValue() };
			})()`),
			"the tab still holds the other note's header cell",
		).toEqual({ attached: false, text: header });

		await click(obsidian, lastUndo);

		expect(
			await eventually(obsidian, () => readVaultText(obsidian, path), before, 10_000),
		).toBe(before);
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
	});

	test.each(["in view", "scrolled out of view"])(
		"#499 after Undo of a capture that widened its column, with the table %s, the next capture lands in the same cell",
		async (where) => {
			const { obsidian } = getContext();
			const table = TABLE.replace(
				"| Start | anchor |",
				"| Start | anchor |\n| Later | other |",
			);
			const below = Array.from({ length: 2000 }, (_, line) => `Paragraph ${line}.`).join(
				"\n",
			);
			const path = await setUp({ content: `${table}${below}\n` });
			const editor = `app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view.editor`;
			await typeText(obsidian, "USER_EDIT");
			if (where === "scrolled out of view") {
				await obsidian.dev.evalJson(
					`(() => { const { scrollDOM } = ${editor}.cm; scrollDOM.scrollTop = scrollDOM.scrollHeight; return true; })()`,
				);
				await obsidian.waitFor(
					() => obsidian.dev.evalJson<boolean>(`${editor}.cm.viewport.from > 1000`),
					{
						timeoutMs: 5_000,
						intervalMs: 100,
						message: "the table out of the editor's viewport",
					},
				);
			}
			const before = await obsidian.dev.evalJson<string>(`${editor}.getValue()`);
			await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
			const captured = await obsidian.dev.evalJson<string>(`${editor}.getValue()`);
			expect(rows(captured).slice(2)).toEqual([
				["Start", "anchorUSER_EDIT00:00:30 \\| cut"],
				["Later", "other"],
			]);
			await click(obsidian, lastUndo);
			expect(
				await eventually(obsidian, () => readVaultText(obsidian, path), before, 10_000),
			).toBe(before);

			await obsidian.exec("command", { id: "podnotes:capture-timestamp" });

			const unpadded = (text: string) => text.replace(/ *\| */g, "|").replace(/-+/g, "-");
			expect(
				await eventually(
					obsidian,
					async () => unpadded(await readVaultText(obsidian, path)),
					unpadded(captured),
					10_000,
				),
			).toBe(unpadded(captured));
		},
		90_000,
	);

	test("#473 a capture into a stale cell of a note in a focused popout keeps the table, and Undo there puts it back", async () => {
		const { obsidian } = getContext();
		const table =
			"# Captures\n\n| Moment | Notes  |\n| ------ | ------ |\n| Start  | anchor |\n| Later  | other  |\n\nAfter table\n";
		const path = await setUp({ content: table });
		const view = `app.workspace.getLeavesOfType("markdown").find((leaf) => leaf.view.file?.path === ${jsLiteral(path)}).view`;
		try {
			await obsidian.dev.evalJsonAsync(`(async () => {
				const main = ${view}.leaf;
				await app.workspace.openPopoutLeaf().openFile(main.view.file, { state: { mode: "source", source: false } });
				main.detach();
				return true;
			})()`);
			await focusNoteWindow(obsidian, path);
			await clickInNoteWindow(obsidian, path, ".markdown-source-view td", "anchor");
			await obsidian.dev.evalJson(`(() => {
				const remote = require("@electron/remote");
				const main = remote.getCurrentWindow();
				const popout = remote.BrowserWindow.getAllWindows().find((win) => win.id !== main.id);
				for (const type of ["keyDown", "keyUp"]) popout.webContents.sendInputEvent({ type, keyCode: "End" });
				return true;
			})()`);
			expect(
				await eventually(
					obsidian,
					() =>
						obsidian.dev.evalJson(
							`${view}.editor.editorComponent.tableCell?.containerEl.ownerDocument === ${view}.containerEl.ownerDocument && ${view}.containerEl.ownerDocument !== document`,
						),
					true,
				),
				"a cell editor open in the popout",
			).toBe(true);
			await obsidian.exec("command", { id: "editor:toggle-source" });
			await obsidian.dev.evalJsonAsync(
				`app.vault.process(app.vault.getAbstractFileByPath(${jsLiteral(path)}), (text) => text.replace("| other  |", "| other, edited elsewhere |")).then(() => true)`,
			);
			const before = table.replace("| other  |", "| other, edited elsewhere |");
			expect(
				await eventually(
					obsidian,
					() => obsidian.dev.evalJson<string>(`${view}.editor.getValue()`),
					before,
					10_000,
				),
			).toBe(before);
			expect(
				await obsidian.dev.evalJson(
					`${view}.editor.editorComponent.tableCell?.containerEl.isConnected ?? null`,
				),
				"Obsidian still holds a cell no longer in the document",
			).toBe(false);
			const caret = await obsidian.dev.evalJson<number>(
				`${view}.editor.posToOffset(${view}.editor.getCursor())`,
			);

			await obsidian.exec("command", { id: "podnotes:capture-timestamp" });

			const captured = `${before.slice(0, caret)}00:00:30 \\| cut ${before.slice(caret)}`;
			expect(rows(captured)[2]).toEqual(["Start", "anchor00:00:30 \\| cut"]);
			expect(
				await eventually(obsidian, () => readVaultText(obsidian, path), captured, 10_000),
			).toBe(captured);
			await clickInNoteWindow(obsidian, path, ".notice button.pn-undo");
			expect(
				await eventually(obsidian, () => readVaultText(obsidian, path), before, 10_000),
			).toBe(before);
			expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
		} finally {
			if (await obsidian.dev.evalJson<number>("app.workspace.floatingSplit.children.length"))
				await closePopoutTab(obsidian, path);
			await obsidian.dev.evalJsonAsync(`(async () => {
				app.workspace.requestSaveLayout.cancel();
				await app.workspace.saveLayout();
				return true;
			})()`);
			await reloadAfterPopout(obsidian);
		}
	}, 90_000);

	test("#445 Source mode still escapes table captures and preserves Undo", async () => {
		const { obsidian } = getContext();
		const path = await setUp({ source: true });
		await obsidian.exec("command", { id: "podnotes:capture-timestamp" });
		const first = "anchor00:00:30 \\| cut ";
		await expectCell(path, first);
		await obsidian.exec("command", { id: "podnotes:capture-segment-10s" });
		const beforeLast = await expectCell(path, `${first}00:00:20-00:00:30 \\| cut `);
		await obsidian.exec("command", { id: "podnotes:capture-segment-20s" });
		await expectCell(path, `${first}00:00:20-00:00:30 \\| cut 00:00:10-00:00:30 \\| cut `);
		await click(obsidian, lastUndo);
		expect(
			await eventually(obsidian, () => readVaultText(obsidian, path), beforeLast, 10_000),
		).toBe(beforeLast);
		expect((await obsidian.exec("dev:errors")).stdout.trim()).toBe("No errors captured.");
	}, 90_000);
});
