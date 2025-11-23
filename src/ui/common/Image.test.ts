import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, test, vi } from "vitest";

import Image from "./Image.svelte";
import ImageFallbackHarness from "./__tests__/ImageFallbackHarness.svelte";

const baseProps = {
	src: "https://example.com/art.jpg",
	alt: "Example artwork",
	fadeIn: true,
};

describe("Image component", () => {
	test("renders interactive button with image attributes", () => {
		const { getByRole } = render(Image, { props: baseProps });

		const button = getByRole("button");
		const img = getByRole("img") as HTMLImageElement;

		expect(button).toHaveClass("pn_image_container");
		expect(img.alt).toBe(baseProps.alt);
		expect(img.getAttribute("src")).toBe(baseProps.src);
	});

	test("bubbles click events through the dispatcher", async () => {
		const handler = vi.fn();
		const { getByRole } = render(Image, {
			props: baseProps,
			events: {
				click: handler,
			},
		});
		await fireEvent.click(getByRole("button"));

		expect(handler).toHaveBeenCalled();
		expect(handler.mock.calls[0][0].detail.event).toBeInstanceOf(MouseEvent);
	});

	test("fades image in once it has loaded", async () => {
		const { getByRole } = render(Image, { props: baseProps });
		const img = getByRole("img") as HTMLImageElement;

		expect(img.style.opacity).toBe("0");

		await fireEvent.load(img);
		await tick();

		expect(img.style.opacity).toBe("1");
	});

	test("shows fallback slot when loading fails", async () => {
		const { getByRole } = render(ImageFallbackHarness, {
			props: {
				props: baseProps,
			},
		});
		const img = getByRole("img");

		await fireEvent.error(img);
		await tick();

		expect(screen.getByText("placeholder")).toBeVisible();
	});
});
