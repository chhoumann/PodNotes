// @vitest-environment jsdom
import { fireEvent, render } from "@testing-library/svelte";
import { expect, test, vi } from "vitest";
import Button from "./Button.svelte";

test("dispatches one click per press, also after its props change", async () => {
	const onClick = vi.fn();
	const view = render(Button, {
		props: { text: "Save", ariaLabel: "Save" },
		events: { click: onClick },
	} as never);
	await view.rerender({ text: "Saved", ariaLabel: "Saved" });

	await fireEvent.click(view.getByRole("button", { name: "Saved" }));

	expect(onClick).toHaveBeenCalledTimes(1);
});
