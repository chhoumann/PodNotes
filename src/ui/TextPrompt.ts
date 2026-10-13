import { type App, Modal, Setting } from "obsidian";

export interface TextPrompt {
	readonly title: string;
	/** The field's name. */
	readonly label: string;
	/** The accepting button. Enter in the field does the same. */
	readonly cta: string;
	readonly placeholder?: string;
	/** What the field holds when the prompt opens. */
	readonly value?: string;
}

/**
 * The trimmed text the user enters, or null when they close the prompt. Empty text is
 * never accepted, and the prompt stays open with the field focused.
 */
export function askText(app: App, prompt: TextPrompt): Promise<string | null> {
	return new Promise((resolve) => new TextPromptModal(app, prompt, resolve).open());
}

class TextPromptModal extends Modal {
	private answer: string | null = null;

	constructor(
		app: App,
		private readonly prompt: TextPrompt,
		private readonly onAnswer: (text: string | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		const { title, label, cta, placeholder = "", value = "" } = this.prompt;
		this.modalEl.classList.add("pn-prompt");
		this.titleEl.setText(title);
		let input: HTMLInputElement | undefined;
		const accept = () => {
			const text = input?.value.trim();
			if (!text) return input?.focus();
			this.answer = text;
			this.close();
		};
		const field = new Setting(this.contentEl).setName(label);
		field.nameEl.id = `podnotes-prompt-${crypto.randomUUID()}`;
		field.addText((text) => {
			input = text.setPlaceholder(placeholder).setValue(value).inputEl;
			input.setAttribute("aria-labelledby", field.nameEl.id);
			input.addEventListener("keydown", (event) => {
				if (event.key !== "Enter" || event.isComposing) return;
				event.preventDefault();
				accept();
			});
		});
		new Setting(this.contentEl)
			.addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((button) => button.setButtonText(cta).setCta().onClick(accept));
		input?.focus();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onAnswer(this.answer);
	}
}
