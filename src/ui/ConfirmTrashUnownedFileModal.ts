import { type App, ButtonComponent, Modal } from "obsidian";

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

		const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
		const keepFile = new ButtonComponent(buttons)
			.setButtonText("Keep file")
			.setCta()
			.onClick(() => this.close());
		new ButtonComponent(buttons)
			.setButtonText("Delete file")
			.setDestructive()
			.onClick(() => {
				this.moveToTrash = true;
				this.close();
			});
		keepFile.buttonEl.focus();
	}

	override onClose(): void {
		this.contentEl.empty();
		this.onAnswer(this.moveToTrash);
	}
}

export function confirmTrashUnownedFile(app: App, filePath: string): Promise<boolean> {
	return new Promise((resolve) =>
		new ConfirmTrashUnownedFileModal(app, filePath, resolve).open(),
	);
}
