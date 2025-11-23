import { fireEvent, render } from "@testing-library/svelte";
import { describe, expect, test, vi } from "vitest";

import Progressbar from "./Progressbar.svelte";

describe("Progressbar", () => {
	test("renders slider with expected attributes and width", () => {
		const { getByRole } = render(Progressbar, {
			props: { value: 25, max: 200 },
		});

		const slider = getByRole("slider");
		expect(slider).toHaveAttribute("aria-valuenow", "25");
		expect(slider).toHaveAttribute("aria-valuemax", "200");
		const bar = slider.querySelector(".progress__bar") as HTMLDivElement | null;
		expect(bar).not.toBeNull();
		expect(bar?.style.width).toBe("12.5%");
	});

	test("announces percent changes from keyboard interactions", async () => {
		const handler = vi.fn();
		const { getByRole } = render(Progressbar, {
			props: { value: 40, max: 200 },
			events: {
				click: handler,
			},
		});
		const slider = getByRole("slider");

		await fireEvent.keyDown(slider, { key: "ArrowRight" });
		await fireEvent.keyDown(slider, { key: "Home" });

		const [incrementEvent, homeEvent] = handler.mock.calls.map(
			(call) => call[0].detail,
		);

		expect(incrementEvent.percent).toBeCloseTo(0.25, 5);
		expect(homeEvent.percent).toBe(0);
	});

	test("fires drag events while mouse is down", async () => {
		const handler = vi.fn();
		const { getByRole } = render(Progressbar, {
			props: { value: 30, max: 100 },
			events: {
				click: handler,
			},
		});
		const slider = getByRole("slider");

		await fireEvent.mouseDown(slider);
		await fireEvent.mouseMove(slider);
		await fireEvent.mouseUp(slider);

		expect(handler).toHaveBeenCalled();
		expect(handler.mock.calls[0][0].detail.percent).toBeUndefined();
		expect(handler.mock.calls[0][0].detail.event).toBeInstanceOf(MouseEvent);
	});
});
