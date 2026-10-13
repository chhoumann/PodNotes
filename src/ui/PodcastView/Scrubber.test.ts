// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";
import Scrubber from "./Scrubber.svelte";

function renderScrubber(props: { position?: number; duration?: number; disabled?: boolean } = {}) {
	const onseek = vi.fn();
	render(Scrubber, {
		props: { position: 600, duration: 3600, chapters: [], disabled: false, onseek, ...props },
	});
	const slider = screen.getByRole("slider", { name: "Seek" });
	slider.getBoundingClientRect = () => ({ left: 100, width: 200 }) as DOMRect;
	return { slider, onseek };
}

describe("the scrubber", () => {
	test("tells its position as time", () => {
		const { slider } = renderScrubber({ position: 754.6, duration: 2700.4 });

		expect(slider).toHaveAttribute("aria-valuenow", "754");
		expect(slider).toHaveAttribute("aria-valuemax", "2700");
		expect(slider).toHaveAttribute("aria-valuetext", "12:34 of 45:00");
	});

	test("seeks 5 s with the arrows, 30 s with Page Up and Down, and to either end", async () => {
		const { slider, onseek } = renderScrubber();

		for (const key of ["ArrowLeft", "ArrowRight", "PageDown", "PageUp", "Home", "End"]) {
			await fireEvent.keyDown(slider, { key });
		}

		expect(onseek.mock.calls).toEqual([[595], [605], [570], [630], [0], [3600]]);
	});

	test("never seeks past either end", async () => {
		const { slider, onseek } = renderScrubber({ position: 3590 });

		await fireEvent.keyDown(slider, { key: "PageUp" });

		expect(onseek).toHaveBeenCalledWith(3600);
	});

	test("follows a press as it moves, and seeks once, where it is released", async () => {
		const { slider, onseek } = renderScrubber();

		await fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 150 });
		await fireEvent.pointerMove(slider, { pointerId: 1, clientX: 250 });
		expect(slider).toHaveAttribute("aria-valuenow", "2700");
		expect(onseek).not.toHaveBeenCalled();
		await fireEvent.pointerUp(slider, { pointerId: 1, clientX: 250 });

		expect(onseek.mock.calls).toEqual([[2700]]);
	});

	test("a cancelled press seeks nothing and shows the position again", async () => {
		const { slider, onseek } = renderScrubber();

		await fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 250 });
		await fireEvent.pointerCancel(slider, { pointerId: 1 });

		expect(slider).toHaveAttribute("aria-valuenow", "600");
		expect(onseek).not.toHaveBeenCalled();
	});

	test("disabled, it leaves the tab order and seeks on no key or press", async () => {
		const { slider, onseek } = renderScrubber({ disabled: true });

		await fireEvent.keyDown(slider, { key: "End" });
		await fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 250 });
		await fireEvent.pointerUp(slider, { pointerId: 1, clientX: 250 });

		expect(slider).toHaveAttribute("tabindex", "-1");
		expect(slider).toHaveAttribute("aria-disabled", "true");
		expect(onseek).not.toHaveBeenCalled();
	});

	test("splits its track at each chapter, filled up to the position", () => {
		const onseek = vi.fn();
		const { container } = render(Scrubber, {
			props: {
				position: 90,
				duration: 180,
				chapters: [0, 60, 120].map((startTime) => ({ startTime, title: "" })),
				disabled: false,
				onseek,
			},
		});

		const fills = [...container.querySelectorAll<HTMLElement>(".pn-seg > span")];
		expect(fills.map((fill) => fill.style.width)).toEqual(["100%", "50%", "0%"]);
	});
});
