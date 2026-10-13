// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/svelte";
import { App } from "obsidian";
import { afterEach, describe, expect, test } from "vitest";
import { askText } from "./TextPrompt";

const PROMPT = {
	title: "New playlist",
	label: "Playlist name",
	placeholder: "Name",
	cta: "Create",
};

/** The prompt's answer, and whether it came yet. */
function ask(prompt: Parameters<typeof askText>[1] = PROMPT) {
	const answers: (string | null)[] = [];
	const answered = askText(new App(), prompt).then((answer) => {
		answers.push(answer);
		return answer;
	});
	return { answers, answered, field: screen.getByRole("textbox", { name: prompt.label }) };
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("askText", () => {
	test("opens titled, with the field focused, its placeholder and its starting value", () => {
		const { field } = ask({ ...PROMPT, value: "Walks" });

		expect(screen.getByText("New playlist")).toBeInTheDocument();
		expect(field).toHaveFocus();
		expect(field).toHaveAttribute("placeholder", "Name");
		expect(field).toHaveValue("Walks");
	});

	test("Enter accepts the trimmed text and closes", async () => {
		const { field, answered } = ask();
		await fireEvent.input(field, { target: { value: "  Walks  " } });
		await fireEvent.keyDown(field, { key: "Enter" });

		expect(await answered).toBe("Walks");
		expect(screen.queryByRole("textbox")).toBeNull();
	});

	test("the CTA accepts the text", async () => {
		const { field, answered } = ask();
		await fireEvent.input(field, { target: { value: "Runs" } });
		await fireEvent.click(screen.getByRole("button", { name: "Create" }));

		expect(await answered).toBe("Runs");
	});

	test("an empty name keeps the prompt open with the field focused", async () => {
		const { field, answers } = ask();
		await fireEvent.input(field, { target: { value: "   " } });
		screen.getByRole("button", { name: "Cancel" }).focus();

		await fireEvent.click(screen.getByRole("button", { name: "Create" }));
		await fireEvent.keyDown(field, { key: "Enter" });
		await Promise.resolve();

		expect(answers).toEqual([]);
		expect(field).toBeInTheDocument();
		expect(field).toHaveFocus();
	});

	test("Enter that ends an IME composition does not accept", async () => {
		const { field, answers } = ask();
		await fireEvent.input(field, { target: { value: "かな" } });
		await fireEvent.keyDown(field, { key: "Enter", isComposing: true });
		await Promise.resolve();

		expect(answers).toEqual([]);
		expect(field).toBeInTheDocument();
	});

	test("Cancel answers null once, whatever the field holds", async () => {
		const { field, answered, answers } = ask();
		await fireEvent.input(field, { target: { value: "Walks" } });
		await fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		expect(await answered).toBeNull();
		expect(answers).toEqual([null]);
		expect(screen.queryByRole("textbox")).toBeNull();
	});
});
