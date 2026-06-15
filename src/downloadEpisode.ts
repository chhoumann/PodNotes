import { Notice, TFile, requestUrl } from "obsidian";
import { downloadedEpisodes } from "./store";
import {
	DownloadPathTemplateEngine,
	replaceIllegalFileNameCharactersInString,
} from "./TemplateEngine";
import type { Episode } from "./types/Episode";
import type { LocalEpisode } from "./types/LocalEpisode";
import { encodeUrlForRequest } from "./utility/encodeUrlForRequest";
import { ensureFolderExists } from "./utility/ensureFolderExists";
import { isLocalFile } from "./utility/isLocalFile";
import getUrlExtension from "./utility/getUrlExtension";
import getExtensionFromContentType from "./utility/getExtensionFromContentType";

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

interface DownloadedFile {
	/**
	 * The raw episode bytes, held exactly once. On memory-constrained mobile
	 * (Android) WebViews this single buffer is threaded straight to
	 * `vault.createBinary`; wrapping it in a Blob and round-tripping back to an
	 * ArrayBuffer used to triple the peak heap and OOM-crash the app (issue #113).
	 */
	data: ArrayBuffer;
	contentType: string;
	byteLength: number;
}

async function downloadFile(
	url: string,
	options?: Partial<{
		onFinished: () => void;
		onError: (error: Error) => void;
	}>,
): Promise<DownloadedFile> {
	const encodedUrl = encodeUrlForRequest(url);
	try {
		const response = await requestUrl({ url: encodedUrl, method: "GET" });

		if (response.status !== 200) {
			throw new Error("Could not download episode.");
		}

		// Read the decoded buffer once and keep that single reference. `requestUrl`
		// has no streaming API, so this 1x copy is unavoidable; everything
		// downstream reuses it instead of allocating further copies.
		const data = response.arrayBuffer;
		const contentType =
			response.headers["content-type"] ??
			response.headers["Content-Type"] ??
			"";

		options?.onFinished?.();

		return { data, contentType, byteLength: data.byteLength };
	} catch (error: unknown) {
		const err = new Error(
			`Failed to download ${url}:\n\n${getErrorMessage(error)}`,
		);
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

	const { data, contentType } = await downloadFile(episode.streamUrl, {
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

	const inferredExtension = inferFileExtensionFromDownload(
		episode,
		data,
		contentType,
	);
	const normalizedType = contentType.toLowerCase();
	const typeAppearsAudio = normalizedType === "" || normalizedType.includes("audio");

	if (!typeAppearsAudio && !inferredExtension) {
		update((bodyEl) => {
			bodyEl.createEl("p", {
				text: `Downloaded file is not an audio file. It is of type "${contentType}". File: ${data.byteLength} bytes.`,
			});
		});

		throw new Error("Not an audio file");
	}

	const fileExtension = inferredExtension ?? "mp3";

	try {
		update((bodyEl) => bodyEl.createEl("p", { text: "Creating file..." }));

		await createEpisodeFile({
			episode,
			downloadPathTemplate,
			data,
			extension: fileExtension,
		});

		update((bodyEl) =>
			bodyEl.createEl("p", {
				text: `Successfully downloaded "${episode.title}" from ${episode.podcastName}.`,
			}),
		);
	} catch (error: unknown) {
		update((bodyEl) => {
			bodyEl.createEl("p", {
				text: `Failed to create file for downloaded episode "${episode.title}" from ${episode.podcastName}.`,
			});

			const errorMsgEl = bodyEl.createEl("p", {
				text: getErrorMessage(error),
			});
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
	data,
	extension,
}: {
	episode: Episode;
	downloadPathTemplate: string;
	data: ArrayBuffer;
	extension: string;
}) {
	const basename = DownloadPathTemplateEngine(downloadPathTemplate, episode);
	const filePath = `${basename}.${extension}`;

	// `createBinary` throws if a parent folder is missing, which previously left
	// users with a templated path like `podcast/{{podcast}}/{{title}}` unable to
	// download anything (issue #86). Create the folders first.
	const folderPath = filePath.split("/").slice(0, -1).join("/");
	await ensureFolderExists(folderPath);

	try {
		await app.vault.createBinary(filePath, data);
	} catch (error: unknown) {
		throw new Error(
			`Failed to write file "${filePath}": ${getErrorMessage(error)}`,
		);
	}

	downloadedEpisodes.addEpisode(episode, filePath, data.byteLength);
}

function resolveLocalEpisodeFilePath(episode: LocalEpisode): string | null {
	const downloadedEpisode = downloadedEpisodes.getEpisode(episode);
	const candidatePaths = [
		episode.filePath,
		downloadedEpisode?.filePath,
		getLocalFilePathFromLink(episode.url),
	];

	for (const possiblePath of candidatePaths) {
		if (!possiblePath) continue;

		const file = app.vault.getAbstractFileByPath(possiblePath);
		if (file instanceof TFile) {
			return file.path;
		}
	}

	return null;
}

function getLocalFilePathFromLink(link: string): string | null {
	if (!link) return null;

	const trimmedLink = link.trim();
	if (!trimmedLink) return null;

	const innerLink = trimmedLink.match(/^\[\[(.*)\]\]$/)?.[1] ?? trimmedLink;
	const [target] = innerLink.split("|");
	const normalizedTarget = target?.trim();

	if (!normalizedTarget) {
		return null;
	}

	const directFile = app.vault.getAbstractFileByPath(normalizedTarget);
	if (directFile instanceof TFile) {
		return directFile.path;
	}

	const linkedFile = app.metadataCache?.getFirstLinkpathDest(
		normalizedTarget,
		"",
	);
	if (linkedFile instanceof TFile) {
		return linkedFile.path;
	}

	return null;
}

function inferFileExtensionFromDownload(
	episode: Episode,
	data: ArrayBuffer,
	contentType: string,
): string | null {
	const signatureExtension = detectAudioFileExtension(data);
	if (signatureExtension) {
		return signatureExtension;
	}

	const urlExtension = getUrlExtension(episode.streamUrl);
	if (urlExtension) {
		return urlExtension;
	}

	return getExtensionFromContentType(contentType);
}

export async function downloadEpisode(
	episode: Episode,
	downloadPathTemplate: string,
): Promise<string> {
	if (isLocalFile(episode)) {
		const localFilePath = resolveLocalEpisodeFilePath(episode);
		if (!localFilePath) {
			throw new Error(
				`Unable to locate the local audio file for "${episode.title}". Try playing the file again.`,
			);
		}

		return localFilePath;
	}

	const basename = DownloadPathTemplateEngine(downloadPathTemplate, episode);
	const fileExtension = await getFileExtension(episode.streamUrl);
	const filePath = `${basename}.${fileExtension}`;

	// Check if the file already exists
	const existingFile = app.vault.getAbstractFileByPath(filePath);
	if (existingFile instanceof TFile) {
		return filePath; // Return the existing file path
	}

	try {
		const { data, contentType } = await downloadFile(episode.streamUrl);

		if (!contentType.includes("audio") && !fileExtension) {
			throw new Error("Not an audio file.");
		}

		await createEpisodeFile({
			episode,
			downloadPathTemplate,
			data,
			extension: fileExtension,
		});

		return filePath;
	} catch (error: unknown) {
		throw new Error(
			`Failed to download ${episode.title}: ${getErrorMessage(error)}`,
		);
	}
}

async function getFileExtension(url: string): Promise<string> {
	const encodedUrl = encodeUrlForRequest(url);
	const urlExtension = getUrlExtension(encodedUrl);
	if (urlExtension) return urlExtension;

	// If URL doesn't have an extension, fetch headers to determine content type
	try {
		const response = await fetch(encodedUrl, { method: "HEAD" });
		const contentType = response.headers.get("content-type");

		const extensionFromContentType = getExtensionFromContentType(contentType);
		if (extensionFromContentType) {
			return extensionFromContentType;
		}
	} catch (error) {
		console.error(`HEAD request failed for ${encodedUrl}`, error);
	}

	// Default to mp3 if we can't determine the type
	return "mp3";
}

/**
 * Resolves the audio bytes for an episode for transcription.
 *
 * The returned bytes always belong to the given episode, regardless of the
 * user's download-path template. This is the fix for issue #107: transcription
 * previously went through downloadEpisode(), which derived an on-disk path from
 * the download-path template and reused whatever file already lived there, so
 * episodes that mapped to the same (non-unique) path — e.g. the default empty
 * path, or any path without `{{title}}` — were transcribed using a different
 * episode's audio.
 *
 * Resolution order:
 * 1. Local files already resolve to a unique, episode-specific path on disk.
 * 2. An already-downloaded copy is reused only when the downloaded-episodes
 *    registry (keyed by the episode, not a collidable path) confirms the file
 *    belongs to THIS episode — preserving the cache without the collision risk.
 * 3. Otherwise the episode's own stream URL is fetched into memory. Nothing is
 *    written to the vault, so the audio can never collide with another episode.
 */
export async function getEpisodeAudioBuffer(
	episode: Episode,
): Promise<{ buffer: ArrayBuffer; extension: string; basename: string }> {
	if (isLocalFile(episode)) {
		const localFilePath = resolveLocalEpisodeFilePath(episode);
		if (!localFilePath) {
			throw new Error(
				`Unable to locate the local audio file for "${episode.title}". Try playing the file again.`,
			);
		}

		return readVaultAudio(localFilePath);
	}

	// Reuse a previously downloaded file only when the registry entry is the SAME
	// episode. The registry is keyed by podcastName+title, which two distinct
	// episodes can share (re-releases, placeholder titles), so also require the
	// stream URL to match before trusting the cached bytes. If it differs (or the
	// URL rotated), fall through to a fresh fetch — correct, just not cached.
	const registered = downloadedEpisodes.getEpisode(episode);
	if (registered?.filePath && registered.streamUrl === episode.streamUrl) {
		const existingFile = app.vault.getAbstractFileByPath(registered.filePath);
		if (existingFile instanceof TFile) {
			return readVaultAudio(registered.filePath);
		}
	}

	try {
		const { data, contentType } = await downloadFile(episode.streamUrl);
		const inferredExtension = inferFileExtensionFromDownload(
			episode,
			data,
			contentType,
		);
		const normalizedType = contentType.toLowerCase();
		const typeAppearsAudio =
			normalizedType === "" || normalizedType.includes("audio");
		if (!typeAppearsAudio && !inferredExtension) {
			throw new Error(
				`The downloaded file is not audio (received "${contentType}"). The episode may be unavailable or require re-authentication.`,
			);
		}

		return {
			buffer: data,
			extension: inferredExtension ?? "mp3",
			basename:
				replaceIllegalFileNameCharactersInString(episode.title) || "episode",
		};
	} catch (error: unknown) {
		throw new Error(
			`Failed to fetch ${episode.title}: ${getErrorMessage(error)}`,
		);
	}
}

async function readVaultAudio(
	filePath: string,
): Promise<{ buffer: ArrayBuffer; extension: string; basename: string }> {
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		throw new Error(`Unable to read the audio file at "${filePath}".`);
	}

	const buffer = await app.vault.readBinary(file);
	return { buffer, extension: file.extension, basename: file.basename };
}

interface AudioSignature {
	signature: number[];
	mask?: number[];
	fileExtension: string;
}

export function detectAudioFileExtension(data: ArrayBuffer): string | null {
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

	const maxSignatureLength = Math.max(
		...audioSignatures.map((sig) => sig.signature.length),
	);
	// Zero-copy view over just the header bytes — no Blob slice, no FileReader,
	// no extra full-file allocation.
	const arr = new Uint8Array(
		data,
		0,
		Math.min(maxSignatureLength, data.byteLength),
	);

	for (const { signature, mask, fileExtension } of audioSignatures) {
		if (signature.length > arr.length) {
			continue;
		}

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
			return fileExtension;
		}
	}

	return null;
}
