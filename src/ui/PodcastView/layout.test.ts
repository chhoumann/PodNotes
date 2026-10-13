// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import { installResizeObserver } from "../../../tests/mocks/resizeObserver";
import { observeWidth } from "./layout";

const uninstalls: Array<() => void> = [];
afterEach(() => uninstalls.splice(0).forEach((uninstall) => uninstall()));

test("width keeps reporting after the view moves to a popout window", () => {
	const main = installResizeObserver(window);
	const popout = { document } as unknown as Window;
	const inPopout = installResizeObserver(popout);
	uninstalls.push(main.uninstall, inPopout.uninstall);
	const el = document.createElement("div");
	let migrate: (win: Window) => void = () => {};
	el.onWindowMigrated = (listener) => {
		migrate = listener;
		return () => {};
	};
	const widths: number[] = [];

	const detach = observeWidth((width) => widths.push(width))(el);
	main.resize(el, 320);
	migrate(popout);
	inPopout.resize(el, 820);

	expect(widths).toEqual([0, 320, 0, 820]);
	expect(main.watching(el)).toBe(0);
	expect(inPopout.watching(el)).toBe(1);
	if (typeof detach === "function") detach();
	expect(inPopout.watching(el)).toBe(0);
});
