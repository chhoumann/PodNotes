import { Notice, TFile, requestUrl } from "obsidian";
import { downloadedEpisodes } from "./store";
import { DownloadPathTemplateEngine } from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import getUrlExtension from "./utility/getUrlExtension";

async function downloadFile(
	url: string,
	options?: Partial<{
		onFinished: () => void;
		onError: (error: Error) => void;
	}>,
) {
	try {
		const response = await requestUrl({ url, method: "GET" });

		if (response.status !== 200) {
			throw new Error("Could not download episode.");
		}

		const contentLength = response.arrayBuffer.byteLength;

		options?.onFinished?.();

		return {
			blob: new Blob([response.arrayBuffer], {
				type:
					response.headers["content-type"] ??
					response.headers["Content-Type"] ??
					"",
			}),
			contentLength,
			receivedLength: contentLength,
			responseUrl: url,
		};
	} catch (error) {
		const err = new Error(`Failed to download ${url}:\n\n${error.message}`);
		options?.onError?.(err);

		throw err;
	}
}

export default async function downloadEpisodeWithNotice(
	episode: Episode,
	downloadPathTemplate: string,
): Promise<void> {
	const { doc, update } = createNoticeDoc(`Download "${episode.title}"`);
	const SOME_LARGE_INT_SO_THE_BOX_DOESNT_AUTO_CLOSE = 999999999;
	const notice = new Notice(doc, SOME_LARGE_INT_SO_THE_BOX_DOESNT_AUTO_CLOSE);

	update((bodyEl) => bodyEl.createEl("p", { text: "Starting download..." }));

	update((bodyEl) => {
		bodyEl.createEl("p", { text: "Downloading..." });
	});

	const { blob } = await downloadFile(episode.streamUrl, {
		onFinished: () => {
			update((bodyEl) => bodyEl.createEl("p", { text: "Download complete!" }));
		},
		onError: (error) => {
			update((bodyEl) =>
				bodyEl.createEl("p", {
					text: `Download failed: ${error.message}`,
				}),
			);
		},
	});

	const fileExtension = await detectAudioFileExtension(blob);
	if (!fileExtension) {
		update((bodyEl) => {
			bodyEl.createEl("p", {
				text: `Could not determine file extension for downloaded file. Blob: ${blob.size} bytes.`,
			});
		});

		throw new Error("Could not determine file extension");
	}

	if (!blob.type.contains("audio") && !fileExtension) {
		update((bodyEl) => {
			bodyEl.createEl("p", {
				text: `Downloaded file is not an audio file. It is of type "${blob.type}". Blob: ${blob.size} bytes.`,
			});
		});

		throw new Error("Not an audio file");
	}

	try {
		update((bodyEl) => bodyEl.createEl("p", { text: "Creating file..." }));

		await createEpisodeFile({
			episode,
			downloadPathTemplate,
			blob,
			extension: fileExtension,
		});

		update((bodyEl) =>
			bodyEl.createEl("p", {
				text: `Successfully downloaded "${episode.title}" from ${episode.podcastName}.`,
			}),
		);
	} catch (error) {
		update((bodyEl) => {
			bodyEl.createEl("p", {
				text: `Failed to create file for downloaded episode "${episode.title}" from ${episode.podcastName}.`,
			});

			const errorMsgEl = bodyEl.createEl("p", { text: error.message });
			errorMsgEl.style.fontStyle = "italic";
		});
	}

	setTimeout(() => notice.hide(), 10000);
}

function createNoticeDoc(title: string) {
	const doc = new DocumentFragment();
	const container = doc.createDiv();
	container.style.width = "100%";
	container.style.display = "flex";

	const titleEl = container.createEl("span", { text: title });
	titleEl.style.textAlign = "center";
	titleEl.style.fontWeight = "bold";
	titleEl.style.marginBottom = "0.5em";

	const bodyEl = doc.createDiv();
	bodyEl.style.display = "flex";
	bodyEl.style.flexDirection = "column";
	bodyEl.style.alignItems = "center";
	bodyEl.style.justifyContent = "center";

	return {
		doc,
		update: (updateFn: (bodyEl: HTMLDivElement) => void, empty = true) => {
			if (empty) bodyEl.empty();
			updateFn(bodyEl);
		},
	};
}

async function createEpisodeFile({
	episode,
	downloadPathTemplate,
	blob,
	extension,
}: {
	episode: Episode;
	downloadPathTemplate: string;
	blob: Blob;
	extension: string;
}) {
	const basename = DownloadPathTemplateEngine(downloadPathTemplate, episode);
	const filePath = `${basename}.${extension}`;

	const buffer = await blob.arrayBuffer();

	try {
		await app.vault.createBinary(filePath, buffer);
	} catch (error) {
		throw new Error(`Failed to write file "${filePath}": ${error.message}`);
	}

	downloadedEpisodes.addEpisode(episode, filePath, blob.size);
}

export async function downloadEpisode(
	episode: Episode,
	downloadPathTemplate: string,
): Promise<string> {
	const basename = DownloadPathTemplateEngine(downloadPathTemplate, episode);
	const fileExtension = await getFileExtension(episode.streamUrl);
	const filePath = `${basename}.${fileExtension}`;

	// Check if the file already exists
	const existingFile = app.vault.getAbstractFileByPath(filePath);
	if (existingFile instanceof TFile) {
		return filePath; // Return the existing file path
	}

	try {
		const { blob, responseUrl } = await downloadFile(episode.streamUrl);

		if (!blob.type.includes("audio") && !fileExtension) {
			throw new Error("Not an audio file.");
		}

		await createEpisodeFile({
			episode,
			downloadPathTemplate,
			blob,
			extension: fileExtension,
		});

		return filePath;
	} catch (error) {
		throw new Error(`Failed to download ${episode.title}: ${error.message}`);
	}
}

async function getFileExtension(url: string): Promise<string> {
	const urlExtension = getUrlExtension(url);
	if (urlExtension) return urlExtension;

	// If URL doesn't have an extension, fetch headers to determine content type
	const response = await fetch(url, { method: "HEAD" });
	const contentType = response.headers.get("content-type");

	if (contentType?.includes("audio/mpeg")) return "mp3";
	if (contentType?.includes("audio/mp4")) return "m4a";
	if (contentType?.includes("audio/ogg")) return "ogg";
	if (contentType?.includes("audio/wav")) return "wav";
	if (contentType?.includes("audio/x-m4a")) return "m4a";

	// Default to mp3 if we can't determine the type
	return "mp3";
}

interface AudioSignature {
	signature: number[];
	mask?: number[];
	fileExtension: string;
}

export async function detectAudioFileExtension(
	blob: Blob,
): Promise<string | null> {
	const audioSignatures: AudioSignature[] = [
		{ signature: [0xff, 0xe0], mask: [0xff, 0xe0], fileExtension: "mp3" },
		{ signature: [0x49, 0x44, 0x33], fileExtension: "mp3" },
		{ signature: [0x52, 0x49, 0x46, 0x46], fileExtension: "wav" },
		{ signature: [0x4f, 0x67, 0x67, 0x53], fileExtension: "ogg" },
		{ signature: [0x66, 0x4c, 0x61, 0x43], fileExtension: "flac" },
		{ signature: [0x4d, 0x34, 0x41, 0x20], fileExtension: "m4a" },
		{
			signature: [0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11],
			fileExtension: "wma",
		},
		{
			signature: [0x23, 0x21, 0x41, 0x4d, 0x52, 0x0a],
			fileExtension: "amr",
		},
	];

	return new Promise((resolve, reject) => {
		const fileReader = new FileReader();
		fileReader.onloadend = (e) => {
			if (!e.target?.result) {
				reject(new Error("No result from file reader"));
				return;
			}

			const arr = new Uint8Array(e.target.result as ArrayBuffer);

			for (const { signature, mask, fileExtension } of audioSignatures) {
				let matches = true;
				for (let i = 0; i < signature.length; i++) {
					if (mask) {
						if ((arr[i] & mask[i]) !== (signature[i] & mask[i])) {
							matches = false;
							break;
						}
					} else {
						if (arr[i] !== signature[i]) {
							matches = false;
							break;
						}
					}
				}
				if (matches) {
					resolve(fileExtension);
					return;
				}
			}
			resolve(null);
		};

		fileReader.onerror = () => {
			reject(fileReader.error);
		};

		fileReader.readAsArrayBuffer(
			blob.slice(
				0,
				Math.max(...audioSignatures.map((sig) => sig.signature.length)),
			),
		);
	});
}
