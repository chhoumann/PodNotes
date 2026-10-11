import { type App, Modal, Setting } from "obsidian";

class ConfirmTrashUnownedFileModal extends Modal {
	private filePath: string;
	private onAnswer: (moveToTrash: boolean) => void;
	private moveToTrash = false;

	constructor(app: App, filePath: string, onAnswer: (moveToTrash: boolean) => void) {
		super(app);
		this.filePath = filePath;
		this.onAnswer = onAnswer;
	}

	override onOpen(): void {
		this.contentEl.createEl("p", {
			text: `PodNotes cannot confirm that it downloaded "${this.filePath}".`,
		});

		new Setting(this.contentEl)
			.addButton((button) => {
				button
					.setButtonText("Keep file")
					.setCta()
					.onClick(() => this.close());
				button.buttonEl.focus();
			})
			.addButton((button) =>
				button
					.setButtonText("Move to trash")
					.setDestructive()
					.onClick(() => {
						this.moveToTrash = true;
						this.close();
					}),
			);
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onAnswer(this.moveToTrash);
	}
}

/** Resolves true only when the user chooses "Move to trash". */
export function confirmTrashUnownedFile(app: App, filePath: string): Promise<boolean> {
	return new Promise((resolve) =>
		new ConfirmTrashUnownedFileModal(app, filePath, resolve).open(),
	);
}
