import { Notice } from "obsidian";

export function pickFile(
	accept: string,
	onContents: (contents: string) => void | Promise<void>,
	options: { maxBytes?: number; tooLargeMessage?: string } = {},
): void {
	// Both pickers read small text files, so cap the size before reading the
	// whole thing into memory. The cap and its message are per-caller so OPML
	// import doesn't inherit the settings-file copy.
	const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
	const tooLargeMessage =
		options.tooLargeMessage ?? "That file is too large to be a PodNotes settings file.";

	const fileInput = activeDocument.body.createEl("input");
	fileInput.type = "file";
	fileInput.accept = accept;
	fileInput.setCssStyles({ display: "none" });

	// The native picker firing "cancel" (no selection) never triggers
	// "change", so clean up the orphaned input then too.
	fileInput.oncancel = () => fileInput.remove();

	fileInput.onchange = (e: Event) => {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		fileInput.remove();

		if (!file) {
			new Notice("No file selected.");
			return;
		}

		if (file.size > maxBytes) {
			new Notice(tooLargeMessage);
			return;
		}

		const reader = new FileReader();
		reader.onload = (event) => {
			const contents = event.target?.result;
			if (typeof contents === "string") {
				void onContents(contents);
			} else {
				new Notice("Could not read the selected file.");
			}
		};
		reader.onerror = () => new Notice("Could not read the selected file.");
		reader.readAsText(file);
	};

	fileInput.click();
}
