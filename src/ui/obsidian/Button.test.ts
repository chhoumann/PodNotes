import { render, waitFor } from "@testing-library/svelte";
import { describe, expect, test } from "vitest";

import Button from "./Button.svelte";

describe("Button", () => {
	test("applies multiple class tokens from Svelte class prop", async () => {
		const { container } = render(Button, {
			props: {
				class: "player-control-button player-play-button",
				icon: "play",
			},
		});

		const button = await waitFor(() => {
			const element = container.querySelector("button");
			expect(element).not.toBeNull();
			return element as HTMLButtonElement;
		});

		expect(button).toHaveClass("player-control-button");
		expect(button).toHaveClass("player-play-button");
	});
});
