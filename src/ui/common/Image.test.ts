// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import { describe, expect, test } from "vitest";

import Image from "./Image.svelte";
import ImageFallbackHarness from "./__tests__/ImageFallbackHarness.svelte";

const baseProps = {
	src: "https://example.com/art.jpg",
	alt: "Example artwork",
	fadeIn: true,
};

describe("Image component", () => {
	test("renders the image with its attributes", () => {
		const { getByRole } = render(Image, { props: baseProps });

		const img = getByRole("img") as HTMLImageElement;

		expect(img.alt).toBe(baseProps.alt);
		expect(img.getAttribute("src")).toBe(baseProps.src);
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
