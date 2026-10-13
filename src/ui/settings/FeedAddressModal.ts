import { type App, Modal, Setting } from "obsidian";

class FeedAddressModal extends Modal {
	private address: string | null = null;

	constructor(
		app: App,
		private readonly podcastTitle: string,
		private readonly onAnswer: (address: string | null) => void,
	) {
		super(app);
	}

	override onOpen(): void {
		this.titleEl.setText(this.podcastTitle);
		let input: HTMLInputElement | undefined;
		const save = () => {
			this.address = input?.value ?? null;
			this.close();
		};
		const setting = new Setting(this.contentEl).setName("Feed address");
		setting.nameEl.id = `podnotes-feed-address-${crypto.randomUUID()}`;
		setting.addText((text) => {
			input = text.inputEl;
			input.setAttribute("aria-labelledby", setting.nameEl.id);
			input.addEventListener("keydown", (event) => {
				if (event.key !== "Enter") return;
				event.preventDefault();
				save();
			});
		});
		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText("Save").setCta().onClick(save),
		);
		input?.focus();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onAnswer(this.address);
	}
}

/** The address the user enters for a feed, or null when they close the dialog. */
export function askFeedAddress(app: App, podcastTitle: string): Promise<string | null> {
	return new Promise((resolve) => new FeedAddressModal(app, podcastTitle, resolve).open());
}
