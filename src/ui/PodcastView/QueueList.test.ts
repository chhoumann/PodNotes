// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import * as obsidian from "obsidian";
import { tick } from "svelte";
import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, onTestFinished, test, vi } from "vitest";
import { DEFAULT_SETTINGS } from "src/constants";
import { queue } from "src/store";
import type { Episode } from "src/types/Episode";
import {
	createTestServices,
	pluginLibrary,
	type TestServices,
} from "../../../tests/mocks/services";
import WithServices from "../../../tests/mocks/WithServices.svelte";
import type { Keymap as FakeKeymap } from "../../../tests/mocks/obsidian";
import QueueList from "./QueueList.svelte";

function episode(title: string, podcastName = "Field Notes"): Episode {
	return {
		title,
		streamUrl: `https://media.test/${encodeURIComponent(podcastName)}/${title}.mp3`,
		url: "",
		description: "",
		content: "",
		podcastName,
		duration: 30 * 60,
	};
}

const [a, b, c] = ["A", "B", "C"].map((title) => episode(title));
let services: TestServices;
let dispose = () => {};

beforeEach(() => {
	({ services, dispose } = createTestServices({ library: pluginLibrary }));
});

afterEach(() => {
	dispose();
	queue.set(structuredClone(DEFAULT_SETTINGS.queue));
	Reflect.deleteProperty(document, "elementFromPoint");
	vi.restoreAllMocks();
});

function renderQueue(...episodes: Episode[]) {
	queue.set({ ...structuredClone(DEFAULT_SETTINGS.queue), episodes });
	return render(WithServices, {
		props: { services, component: QueueList, props: { empty: "Nothing here yet" } },
	});
}

const queued = () => get(queue).episodes.map(({ title, podcastName }) => `${podcastName}/${title}`);
const listed = () =>
	screen.queryAllByRole("listitem").map((row) => row.querySelector(".pn-ep-title")?.textContent);
const grip = (title: string) =>
	screen.getByRole("button", { name: new RegExp(`^Reorder ${title},`) });
/** An Escape as Obsidian delivers it: to the newest scope of the window's keymap. */
const escape = () =>
	(services.app.keymap as unknown as FakeKeymap).dispatch(
		new KeyboardEvent("keydown", { key: "Escape" }),
	);

function layOutRows(shown = 1000) {
	const rows = [...document.querySelectorAll<HTMLElement>(".pn-ep")];
	for (const [index, row] of rows.entries()) {
		vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
			top: index * 40,
			bottom: index * 40 + 40,
			left: 0,
			right: 300,
		} as DOMRect);
	}
	document.elementFromPoint = (x, y) => {
		const inView = x >= 0 && x < 300 && y >= 0 && y < shown;
		return (inView && rows[Math.floor(y / 40)]?.querySelector(".pn-ep-title")) || document.body;
	};
}

describe("the queue list", () => {
	test("lists the queue in its order, each with a grip that says where it is", () => {
		renderQueue(a, b, c);

		expect(listed()).toEqual(["A", "B", "C"]);
		expect(grip("B")).toHaveAccessibleName(
			"Reorder B, position 2 of 3. Use arrow keys to move.",
		);
		expect(grip("B")).toHaveAttribute("title", "Drag or use arrow keys");
	});

	test("says when the queue is empty", () => {
		renderQueue();

		expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
		expect(screen.queryByRole("list")).toBeNull();
	});

	test("Down moves an episode after the next one and keeps focus on its grip", async () => {
		renderQueue(a, b, c);
		const moved = grip("A");
		moved.focus();

		await fireEvent.keyDown(moved, { key: "ArrowDown" });
		await tick();

		expect(queued()).toEqual(["Field Notes/B", "Field Notes/A", "Field Notes/C"]);
		expect(listed()).toEqual(["B", "A", "C"]);
		expect(moved).toHaveFocus();
		expect(moved).toHaveAccessibleName("Reorder A, position 2 of 3. Use arrow keys to move.");
	});

	test("Up moves an episode before the one above it", async () => {
		renderQueue(a, b, c);

		await fireEvent.keyDown(grip("C"), { key: "ArrowUp" });

		expect(queued()).toEqual(["Field Notes/A", "Field Notes/C", "Field Notes/B"]);
	});

	test("Up on the first and Down on the last change nothing", async () => {
		renderQueue(a, b, c);
		let writes = 0;
		const unsubscribe = queue.subscribe(() => writes++);

		await fireEvent.keyDown(grip("A"), { key: "ArrowUp" });
		await fireEvent.keyDown(grip("C"), { key: "ArrowDown" });
		unsubscribe();

		expect(queued()).toEqual(["Field Notes/A", "Field Notes/B", "Field Notes/C"]);
		expect(writes).toBe(1);
	});

	test("lists, moves and removes same-titled episodes of different podcasts apart (#356)", async () => {
		const [first, second] = [episode("Trailer", "Pod A"), episode("Trailer", "Pod B")];
		renderQueue(first, second);
		const [, secondGrip] = screen.getAllByRole("button", { name: /^Reorder Trailer,/ });

		await fireEvent.keyDown(secondGrip, { key: "ArrowUp" });
		expect(queued()).toEqual(["Pod B/Trailer", "Pod A/Trailer"]);

		const [, removeFirst] = screen.getAllByRole("button", {
			name: "Remove Trailer from queue",
		});
		await fireEvent.click(removeFirst);
		expect(queued()).toEqual(["Pod B/Trailer"]);
	});

	test("a row's remove button takes it out of the queue", async () => {
		renderQueue(a, b, c);

		await fireEvent.click(screen.getByRole("button", { name: "Remove B from queue" }));

		expect(queued()).toEqual(["Field Notes/A", "Field Notes/C"]);
		expect(listed()).toEqual(["A", "C"]);
	});

	test("a row opens the episode menu, without the queue's own items", async () => {
		renderQueue(a, b);
		const titles = vi.spyOn(obsidian.MenuItem.prototype, "setTitle");

		await fireEvent.contextMenu(screen.getByText("B"));

		expect(titles.mock.calls.slice(0, 2)).toEqual([["Play"], ["Remove from queue"]]);
	});
});

describe("dragging a grip", () => {
	const at = (y: number, pointerId = 1, buttons = 1, x = 150) => ({
		clientX: x,
		clientY: y,
		pointerId,
		buttons,
	});
	const d = episode("D");

	/** Every order the queue store notifies, the current one first. */
	function notified(): string[][] {
		const orders: string[][] = [];
		const unsubscribe = queue.subscribe(({ episodes }) =>
			orders.push(episodes.map(({ title }) => title)),
		);
		onTestFinished(unsubscribe);
		return orders;
	}

	test("shows the episode beside each row the pointer crosses, and writes the queue once, on release, in the order shown", async () => {
		renderQueue(a, b, c, d);
		const orders = notified();
		layOutRows();

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0 });
		expect(grip("A")).toHaveClass("is-dragging");
		await fireEvent.pointerMove(window, at(70));
		expect(listed()).toEqual(["B", "A", "C", "D"]);
		layOutRows();
		await fireEvent.pointerMove(window, at(110));
		expect(listed()).toEqual(["B", "C", "A", "D"]);
		layOutRows();
		await fireEvent.pointerMove(window, at(150));
		expect(listed()).toEqual(["B", "C", "D", "A"]);
		expect(orders).toEqual([["A", "B", "C", "D"]]);

		await fireEvent.pointerUp(window, at(150));
		layOutRows();
		await fireEvent.pointerMove(window, at(10));

		expect(orders).toEqual([
			["A", "B", "C", "D"],
			["B", "C", "D", "A"],
		]);
		expect(listed()).toEqual(["B", "C", "D", "A"]);
		expect(document.querySelector(".pn-grip.is-dragging")).toBeNull();
	});

	test("keeps focus on the grip as its row moves down the list", async () => {
		renderQueue(a, b, c);
		layOutRows();

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(70));
		await tick();

		expect(listed()).toEqual(["B", "A", "C"]);
		expect(grip("A")).toHaveFocus();
	});

	test("over the row it moved to, keeps showing it there", async () => {
		renderQueue(a, b, c);
		layOutRows();

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(70));
		layOutRows();
		await fireEvent.pointerMove(window, at(50));
		expect(listed()).toEqual(["B", "A", "C"]);

		await fireEvent.pointerUp(window, at(50));
		expect(queued()).toEqual(["Field Notes/B", "Field Notes/A", "Field Notes/C"]);
	});

	test("over the row's own band, or past the list, moves nothing", async () => {
		renderQueue(a, b, c);
		const orders = notified();
		layOutRows();

		await fireEvent.pointerDown(grip("B"), { ...at(60), button: 0 });
		await fireEvent.pointerMove(window, at(55));
		await fireEvent.pointerMove(window, at(500));
		expect(listed()).toEqual(["A", "B", "C"]);
		await fireEvent.pointerUp(window, at(500));

		expect(orders).toEqual([["A", "B", "C"]]);
	});

	test("beside the view, or over a row the page has scrolled out of sight, moves nothing", async () => {
		renderQueue(a, b, c);
		layOutRows(100);

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(70, 1, 1, 400));
		await fireEvent.pointerMove(window, at(115));
		expect(listed()).toEqual(["A", "B", "C"]);

		await fireEvent.pointerMove(window, at(70));
		expect(listed()).toEqual(["B", "A", "C"]);
	});

	test("over a row of another Queue, as in a second PodNotes view, moves nothing", async () => {
		renderQueue(a, b, c);
		render(WithServices, {
			props: { services, component: QueueList, props: { empty: "Nothing here yet" } },
		});
		layOutRows();
		const ownGrip = () => screen.getAllByRole("button", { name: /^Reorder A,/ })[0];

		await fireEvent.pointerDown(ownGrip(), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(190));
		await fireEvent.pointerUp(window, at(190));
		expect(queued()).toEqual(["Field Notes/A", "Field Notes/B", "Field Notes/C"]);

		await fireEvent.pointerDown(ownGrip(), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(70));
		await fireEvent.pointerUp(window, at(70));
		expect(queued()).toEqual(["Field Notes/B", "Field Notes/A", "Field Notes/C"]);
	});

	test("ignores another pointer, and Escape ends the drag where it began, writing nothing", async () => {
		renderQueue(a, b, c);
		const orders = notified();
		layOutRows();

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(110, 2));
		expect(listed()).toEqual(["A", "B", "C"]);
		await fireEvent.pointerMove(window, at(70));
		expect(listed()).toEqual(["B", "A", "C"]);

		escape();
		await tick();
		expect(listed()).toEqual(["A", "B", "C"]);
		layOutRows();
		await fireEvent.pointerMove(window, at(110));
		await fireEvent.pointerUp(window, at(110));

		expect(listed()).toEqual(["A", "B", "C"]);
		expect(orders).toEqual([["A", "B", "C"]]);
	});

	test("a cancelled pointer ends the drag where it began, writing nothing", async () => {
		renderQueue(a, b, c);
		const orders = notified();
		layOutRows();

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(70));
		await fireEvent.pointerCancel(window, at(70));

		expect(listed()).toEqual(["A", "B", "C"]);
		expect(orders).toEqual([["A", "B", "C"]]);
		expect(document.querySelector(".pn-grip.is-dragging")).toBeNull();
	});

	test("ends, writing nothing, when the dragged episode leaves the queue, even if it comes back", async () => {
		renderQueue(a, b, c);
		layOutRows();

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(70));
		queue.remove(a);
		await tick();
		expect(listed()).toEqual(["B", "C"]);

		queue.add(a);
		await tick();
		layOutRows();
		await fireEvent.pointerMove(window, at(10));
		await fireEvent.pointerUp(window, at(10));
		expect(queued()).toEqual(["Field Notes/B", "Field Notes/C", "Field Notes/A"]);
		expect(document.querySelector(".pn-grip.is-dragging")).toBeNull();
	});

	test("an entry queued mid-drag keeps its place, and the drop puts the episode by the row it was shown beside", async () => {
		renderQueue(a, b, c);
		const orders = notified();
		layOutRows();

		await fireEvent.pointerDown(grip("C"), { ...at(100), button: 0 });
		await fireEvent.pointerMove(window, at(50));
		expect(listed()).toEqual(["A", "C", "B"]);
		queue.prepend(episode("X"));
		await tick();
		expect(listed()).toEqual(["X", "A", "C", "B"]);
		await fireEvent.pointerUp(window, at(50));

		expect(orders).toEqual([
			["A", "B", "C"],
			["X", "A", "B", "C"],
			["X", "A", "C", "B"],
		]);
	});

	test("a mouse that comes back with its button up drops the episode where it was shown", async () => {
		renderQueue(a, b, c);
		layOutRows();

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0, pointerType: "mouse" });
		await fireEvent.pointerMove(window, { ...at(70), pointerType: "mouse" });
		layOutRows();
		await fireEvent.pointerMove(window, { ...at(110, 1, 0), pointerType: "mouse" });

		expect(queued()).toEqual(["Field Notes/B", "Field Notes/A", "Field Notes/C"]);
		expect(document.querySelector(".pn-grip.is-dragging")).toBeNull();
	});

	test("leaving the page mid-drag writes nothing and removes every listener the drag added", async () => {
		const { unmount } = renderQueue(a, b, c);
		const orders = notified();
		layOutRows();
		const added = vi.spyOn(window, "addEventListener");
		const removed = vi.spyOn(window, "removeEventListener");
		const passedOn = vi.fn(() => false);
		services.app.scope.register(null, "Escape", passedOn);

		await fireEvent.pointerDown(grip("A"), { ...at(20), button: 0 });
		await fireEvent.pointerMove(window, at(70));
		const listening = added.mock.calls.map(([type, listener]) => [type, listener]);
		expect(removed).not.toHaveBeenCalled();
		unmount();

		expect(orders).toEqual([["A", "B", "C"]]);
		expect(listening.map(([type]) => type)).toEqual([
			"pointermove",
			"pointerup",
			"pointercancel",
		]);
		expect(removed.mock.calls.map(([type, listener]) => [type, listener])).toEqual(
			expect.arrayContaining(listening),
		);
		escape();
		expect(passedOn).toHaveBeenCalledTimes(1);
	});
});
