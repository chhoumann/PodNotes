import { normalizePath, Notice, TFile } from "obsidian";
import { get } from "svelte/store";
import { downloadedEpisodes, plugin } from "./store";
import {
	DownloadPathTemplateEngine,
	replaceIllegalFileNameCharactersInString,
} from "./TemplateEngine";
import type { Episode, EpisodeMediaType } from "./types/Episode";
import type { LocalEpisode } from "./types/LocalEpisode";
import { enforceMaxPathLength } from "./utility/enforceMaxPathLength";
import { ensureFolderExists } from "./utility/ensureFolderExists";
import { isLocalFile } from "./utility/isLocalFile";
import getUrlExtension from "./utility/getUrlExtension";
import getExtensionFromContentType from "./utility/getExtensionFromContentType";
import {
	getEpisodeMediaType,
	getEpisodeMediaTypeWithContainerHint,
	getMediaTypeFromContentType,
	getMediaTypeFromExtension,
	getMediaTypeFromPath,
	isAudioContainerExtension,
	isPlayableMediaExtension,
	isSameMediaSource,
} from "./utility/mediaType";
import {
	appendableAdapter,
	moveIntoPlace,
	partialPathFor,
	probeAndFetchFirstChunk,
	sweepStalePartials,
	writeStreamedFile,
	MAX_DOWNLOAD_SIZE,
} from "./download/streaming";
import { detectAudioFileExtension } from "./download/mediaSignatures";
import { NetworkError, requestWithTimeout } from "./utility/networkRequest";

const WHOLE_FILE_DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

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

// Whole-file download: only the legacy fallback (adapters without binary append)
// and transcription's getEpisodeAudioBuffer still need the entire buffer at once.
// The Download command streams instead — see downloadEpisodeToDisk.
async function downloadFile(url: string): Promise<DownloadedFile> {
	let response;
	try {
		response = await requestWithTimeout(url, {
			method: "GET",
			timeoutMs: WHOLE_FILE_DOWNLOAD_TIMEOUT_MS,
			maxResponseBytes: MAX_DOWNLOAD_SIZE,
			acceptedStatuses: [200],
		});
	} catch (error: unknown) {
		if (error instanceof NetworkError) {
			throw new Error(`Failed to download episode: ${error.message}`);
		}
		throw new Error("Failed to download episode.");
	}

	const data = response.arrayBuffer;
	const contentType = response.headers["content-type"] ?? response.headers["Content-Type"] ?? "";

	return { data, contentType, byteLength: data.byteLength };
}

function parentFolderPath(filePath: string): string {
	return filePath.split("/").slice(0, -1).join("/");
}

// One destination family can have only one live download. The map is acquired
// before any request or allocation and released only after the underlying work
// and cleanup settle. Different episodes never share another download's result.
const downloadsInFlight = new Map<string, true>();

function normalizedDestinationFamily(downloadPathTemplate: string, episode: Episode): string {
	return normalizePath(safeDownloadBasename(downloadPathTemplate, episode));
}

function downloadAlreadyInProgressError(): Error {
	return new Error("A download is already in progress for the selected destination.");
}

function downloadDestinationCollisionError(): Error {
	return new Error("A different episode already occupies the selected destination.");
}

// Single source of truth for "what extension and on-disk path does this download
// get, and is it even playable". Shared by the streaming and legacy paths so the
// playability rule (#DL-07 / #213) and path resolution live in exactly one place.
// `headerBytes` only needs the first chunk — the signature sniff reads ~12 bytes.
function resolveDownloadTarget(
	episode: Episode,
	downloadPathTemplate: string,
	headerBytes: ArrayBuffer,
	contentType: string,
): { extension: string; filePath: string } {
	const extension = inferFileExtensionFromDownload(episode, headerBytes, contentType) ?? "mp3";
	if (!downloadAppearsPlayable(contentType, extension, episode.mediaType)) {
		throw new Error("Not a playable media file");
	}
	return {
		extension,
		filePath: safeDownloadFilePath(downloadPathTemplate, episode, extension),
	};
}

function registeredDownloadOwnsPath(episode: Episode, filePath: string): boolean {
	const normalizedPath = normalizePath(filePath);
	const registered = downloadedEpisodes.getEpisode(episode);
	if (!registered || normalizePath(registered.filePath) !== normalizedPath) return false;

	const anotherOwner = Object.values(get(downloadedEpisodes))
		.flat()
		.some(
			(candidate) =>
				candidate !== registered && normalizePath(candidate.filePath) === normalizedPath,
		);
	if (anotherOwner) return false;

	if (isLocalFile(episode)) {
		return Boolean(episode.filePath && normalizePath(episode.filePath) === normalizedPath);
	}
	return isSameMediaSource(registered.streamUrl, episode.streamUrl);
}

function reusableExistingDownloadSize(episode: Episode, filePath: string): number | undefined {
	const existing = get(plugin).app.vault.getAbstractFileByPath(filePath);
	if (!(existing instanceof TFile)) return undefined;
	if (!registeredDownloadOwnsPath(episode, filePath)) {
		throw downloadDestinationCollisionError();
	}
	return downloadedEpisodes.getEpisode(episode)?.size;
}

// Download an episode to a vault file with bounded memory. Streams via Range
// chunks when the adapter supports binary append; otherwise falls back to the
// legacy whole-file buffer (so a non-appendable adapter is never truncated).
// Returns the on-disk path.
async function startDownloadEpisodeToDisk(
	episode: Episode,
	downloadPathTemplate: string,
	onProgress?: (written: number, total: number | null) => void,
): Promise<string> {
	// Fast path: if this episode is already on disk under the extension its URL
	// implies, skip the (potentially multi-MB) Range probe entirely. The probe is
	// only needed to discover the extension when the URL lacks one, or to confirm
	// the final path when the URL's extension is wrong — both still handled below.
	const urlExtension = getUrlExtension(episode.streamUrl);
	if (urlExtension) {
		const provisionalPath = safeDownloadFilePath(downloadPathTemplate, episode, urlExtension);
		const cachedSize = reusableExistingDownloadSize(episode, provisionalPath);
		if (cachedSize !== undefined) {
			downloadedEpisodes.addEpisode(episode, provisionalPath, cachedSize);
			return provisionalPath;
		}
	}

	const adapter = appendableAdapter();
	const canStream =
		typeof adapter.writeBinary === "function" && typeof adapter.appendBinary === "function";

	if (!canStream) {
		const { data, contentType } = await downloadFile(episode.streamUrl);
		const { extension, filePath } = resolveDownloadTarget(
			episode,
			downloadPathTemplate,
			data,
			contentType,
		);
		const existingSize = reusableExistingDownloadSize(episode, filePath);
		if (existingSize !== undefined) {
			downloadedEpisodes.addEpisode(episode, filePath, existingSize);
			return filePath;
		}
		await createEpisodeFile({ episode, downloadPathTemplate, data, extension });
		return filePath;
	}

	const probe = await probeAndFetchFirstChunk(episode.streamUrl);
	const { filePath } = resolveDownloadTarget(
		episode,
		downloadPathTemplate,
		probe.firstChunk,
		probe.contentType,
	);
	const existingSize = reusableExistingDownloadSize(episode, filePath);
	if (existingSize !== undefined) {
		downloadedEpisodes.addEpisode(episode, filePath, existingSize);
		return filePath;
	}

	await ensureFolderExists(parentFolderPath(filePath));

	// Stream to a sibling temp the vault watchers never see, then move the finished
	// file into place as one rename - so watcher plugins don't get a per-chunk
	// modify storm on the growing media file and re-scan it into an OOM crash.
	const tmpPath = partialPathFor(filePath);
	let moved = false;
	try {
		// When another destination is active, keep every partial. A later solo
		// download will sweep any orphan once no live writer could own it.
		await sweepStalePartials(parentFolderPath(filePath), () => downloadsInFlight.size > 1);

		const total = await writeStreamedFile(episode.streamUrl, tmpPath, probe, onProgress);
		if (probe.totalSize !== null && total !== probe.totalSize) {
			throw new Error(`Incomplete download: got ${total} of ${probe.totalSize} bytes.`);
		}

		await moveIntoPlace(tmpPath, filePath);
		moved = true;

		downloadedEpisodes.addEpisode(episode, filePath, total);
		return filePath;
	} finally {
		if (!moved) await deleteEpisodeFile(tmpPath);
	}
}

async function downloadEpisodeToDisk(
	episode: Episode,
	downloadPathTemplate: string,
	onProgress?: (written: number, total: number | null) => void,
): Promise<string> {
	const destination = normalizedDestinationFamily(downloadPathTemplate, episode);
	if (downloadsInFlight.has(destination)) throw downloadAlreadyInProgressError();
	downloadsInFlight.set(destination, true);
	try {
		return await startDownloadEpisodeToDisk(episode, downloadPathTemplate, onProgress);
	} finally {
		downloadsInFlight.delete(destination);
	}
}

export default async function downloadEpisodeWithNotice(
	episode: Episode,
	downloadPathTemplate: string,
): Promise<void> {
	const { doc, update } = createNoticeDoc(`Download "${episode.title}"`);
	const SOME_LARGE_INT_SO_THE_BOX_DOESNT_AUTO_CLOSE = 999999999;
	const notice = new Notice(doc, SOME_LARGE_INT_SO_THE_BOX_DOESNT_AUTO_CLOSE);

	const showSuccess = () =>
		update((bodyEl) =>
			bodyEl.createEl("p", {
				text: `Successfully downloaded "${episode.title}" from ${episode.podcastName}.`,
			}),
		);

	// This UX wrapper reports every failure as a Notice and always dismisses it
	// exactly once (#DL-03), then rethrows so the (fire-and-forget) caller can log
	// it. Callers that need the resulting path call downloadEpisodeToDisk directly.
	try {
		update((bodyEl) => bodyEl.createEl("p", { text: "Starting download..." }));

		const work = downloadEpisodeToDisk(episode, downloadPathTemplate, (written, total) => {
			const mb = (written / (1024 * 1024)).toFixed(1);
			const pct = total && total > 0 ? ` ${Math.round((written / total) * 100)}%` : "";
			update((bodyEl) => bodyEl.createEl("p", { text: `Downloading...${pct} (${mb} MB)` }));
		});
		await work;

		showSuccess();
	} catch (error: unknown) {
		update((bodyEl) => {
			const errorEl = bodyEl.createEl("p", {
				text: `Download failed: ${getErrorMessage(error)}`,
			});
			errorEl.setCssStyles({ fontStyle: "italic" });
		});
		throw error;
	} finally {
		window.setTimeout(() => notice.hide(), 10000);
	}
}

function createNoticeDoc(title: string) {
	const doc = new DocumentFragment();
	const container = doc.createDiv();
	container.setCssStyles({ width: "100%", display: "flex" });

	const titleEl = container.createEl("span", { text: title });
	titleEl.setCssStyles({
		textAlign: "center",
		fontWeight: "bold",
		marginBottom: "0.5em",
	});

	const bodyEl = doc.createDiv();
	bodyEl.setCssStyles({
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		justifyContent: "center",
	});

	return {
		doc,
		update: (updateFn: (bodyEl: HTMLDivElement) => void, empty = true) => {
			if (empty) bodyEl.empty();
			updateFn(bodyEl);
		},
	};
}

/**
 * Resolves the on-disk basename for a downloaded episode, guaranteeing a
 * per-episode file name even when the template is misconfigured.
 *
 * A template that resolves to an empty final segment — the legacy empty default
 * `""`, or any path ending in `/` — would otherwise produce a hidden `".<ext>"`
 * dotfile at the vault root that Obsidian never indexes, so the first download
 * silently writes junk and the second throws "File already exists" (#183). In
 * that case we fall back to the episode title (then a literal "episode" when the
 * title is empty or all-illegal). Leading/interior empty segments are dropped so
 * a stray slash can never yield an absolute-looking or double-slashed path.
 */
export function safeDownloadBasename(downloadPathTemplate: string, episode: Episode): string {
	const resolved = DownloadPathTemplateEngine(downloadPathTemplate, episode);
	const segments = resolved.split("/");
	const lastIndex = segments.length - 1;

	if (segments[lastIndex].trim() === "") {
		segments[lastIndex] = replaceIllegalFileNameCharactersInString(episode.title) || "episode";
	}

	return segments
		.filter((segment, index) => index === lastIndex || segment.trim() !== "")
		.join("/");
}

/**
 * The on-disk path for a downloaded episode, with a long title capped so it can't
 * trip ENAMETOOLONG (#22). Both the pre-download existence check and the write go
 * through this, so they always agree on the same (capped) path.
 */
export function safeDownloadFilePath(
	downloadPathTemplate: string,
	episode: Episode,
	extension: string,
): string {
	const basename = safeDownloadBasename(downloadPathTemplate, episode);
	return enforceMaxPathLength(`${basename}.${extension}`, `.${extension}`);
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
	const { app } = get(plugin);
	const filePath = safeDownloadFilePath(downloadPathTemplate, episode, extension);

	// `createBinary` throws if a parent folder is missing, which previously left
	// users with a templated path like `podcast/{{podcast}}/{{title}}` unable to
	// download anything (issue #86). Create the folders first.
	const folderPath = filePath.split("/").slice(0, -1).join("/");
	await ensureFolderExists(folderPath);

	try {
		await app.vault.createBinary(filePath, data);
	} catch (error: unknown) {
		throw new Error(`Failed to write file "${filePath}": ${getErrorMessage(error)}`);
	}

	downloadedEpisodes.addEpisode(episode, filePath, data.byteLength);
}

/**
 * Remove a downloaded episode: drop it from the offline set and delete its
 * backing vault file. This composes the pure store removal with the file I/O so
 * callers can't do one without the other (and leak files); the download store
 * stays free of vault side effects.
 */
export async function removeDownloadedEpisode(episode: Episode): Promise<void> {
	const removedFilePath = downloadedEpisodes.removeEpisode(episode);
	if (removedFilePath) {
		await deleteEpisodeFile(removedFilePath);
	}
}

// Best-effort: a missing/already-removed file is a no-op, and failures are logged
// rather than thrown so removing a stale entry never breaks the calling UI flow.
async function deleteEpisodeFile(filePath: string): Promise<void> {
	if (!filePath) return;

	const { app } = get(plugin);
	try {
		const file = app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			await app.vault.delete(file);
			return;
		}
		// Streamed downloads are written through the adapter, so the vault index
		// may not have reconciled the file yet and getAbstractFileByPath can miss a
		// freshly written partial. Remove it directly through the adapter so a
		// failed streamed download never leaves bytes behind (#218).
		const { adapter } = app.vault;
		if (await adapter.exists(filePath)) {
			await adapter.remove(filePath);
		}
	} catch (error) {
		console.error(`Failed to delete downloaded file "${filePath}":`, error);
	}
}

function resolveLocalEpisodeFilePath(episode: LocalEpisode): string | null {
	const { app } = get(plugin);
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

	const { app } = get(plugin);

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

	const linkedFile = app.metadataCache?.getFirstLinkpathDest(normalizedTarget, "");
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
	const contentTypeExtension = getExtensionFromContentType(contentType);
	if (getMediaTypeFromContentType(contentType) === "video" && contentTypeExtension) {
		return contentTypeExtension;
	}

	const urlExtension = getUrlExtension(episode.streamUrl);
	if (
		getMediaTypeFromExtension(urlExtension) === "video" &&
		!isAudioContainerExtension(urlExtension)
	) {
		return urlExtension;
	}

	const signatureExtension = detectAudioFileExtension(data);
	if (signatureExtension) {
		// A generic ISO-BMFF brand (mp42/isom/M4B...) resolves to "mp4"; for an
		// audio download keep it as m4a so a podcast served as audio/mp4 isn't
		// saved as *.mp4 and later treated as an ambiguous audio/video container
		// (Codex review #213). The hint comes from the content type or, failing
		// that, the episode's known media type.
		const isAudioDownload =
			getMediaTypeFromContentType(contentType) === "audio" || episode.mediaType === "audio";
		return (
			normalizeAudioExtension(signatureExtension, isAudioDownload ? "audio" : undefined) ??
			signatureExtension
		);
	}

	if (contentTypeExtension) {
		return contentTypeExtension;
	}

	if (urlExtension) {
		return urlExtension;
	}

	return null;
}

/**
 * Known non-media content types that can never be playable, even when the stream
 * URL ends in `.mp3`/`.mp4`: an expired private feed or a CDN that answers a 200
 * with an HTML/JSON error page (#DL-07). Only KNOWN textual/document types are
 * rejected here — `application/octet-stream` and other genuinely ambiguous binary
 * types are intentionally NOT listed, because servers legitimately serve real
 * media as octet-stream, so those still fall through to the extension/signature
 * heuristic.
 */
function isKnownNonMediaContentType(contentType: string): boolean {
	const normalizedType = contentType.split(";")[0].trim().toLowerCase();
	if (!normalizedType) return false;

	return (
		normalizedType.startsWith("text/") ||
		normalizedType === "application/json" ||
		normalizedType === "application/xml" ||
		// Structured XML/JSON families: rss+xml, atom+xml, xhtml+xml, problem+json,
		// ld+json, etc. An expired/private feed often answers a media URL with one
		// of these, and no real audio/video type uses a +xml/+json suffix (#DL-07 /
		// Codex review #213).
		normalizedType.endsWith("+xml") ||
		normalizedType.endsWith("+json")
	);
}

function downloadAppearsPlayable(
	contentType: string,
	extension: string | null,
	mediaTypeHint?: EpisodeMediaType,
): boolean {
	if (isKnownNonMediaContentType(contentType)) {
		return false;
	}

	const normalizedType = contentType.toLowerCase();
	const contentMediaType = getMediaTypeFromContentType(normalizedType);

	if (contentMediaType === "video") {
		return getMediaTypeFromExtension(extension) === "video";
	}

	if (normalizedType === "" && mediaTypeHint === "video") {
		return getMediaTypeFromExtension(extension) === "video";
	}

	return (
		normalizedType === "" || contentMediaType === "audio" || isPlayableMediaExtension(extension)
	);
}

function downloadAppearsAudio(
	contentType: string,
	extension: string | null,
	mediaTypeHint?: EpisodeMediaType,
): boolean {
	if (isKnownNonMediaContentType(contentType)) {
		return false;
	}

	const contentMediaType = getMediaTypeFromContentType(contentType);
	if (contentMediaType) {
		return contentMediaType === "audio" || isExplicitAudioContainer(extension, mediaTypeHint);
	}

	const normalizedType = contentType.toLowerCase();
	return (
		normalizedType === "" ||
		getMediaTypeFromExtension(extension) === "audio" ||
		isExplicitAudioContainer(extension, mediaTypeHint)
	);
}

function isExplicitAudioContainer(
	extension: string | null | undefined,
	mediaTypeHint?: EpisodeMediaType,
): boolean {
	return mediaTypeHint === "audio" && isAudioContainerExtension(extension);
}

function normalizeAudioExtension(
	extension: string | null,
	mediaTypeHint?: EpisodeMediaType,
): string | null {
	if (mediaTypeHint === "audio" && extension?.toLowerCase() === "mp4") {
		return "m4a";
	}

	return extension;
}

/**
 * Resolves the audio bytes for an episode for transcription.
 *
 * The returned bytes always belong to the given episode, regardless of the
 * user's download-path template. This is the fix for issue #107: transcription
 * previously went through the legacy download-to-disk path, which derived an
 * on-disk path from the download-path template and reused whatever file already
 * lived there, so
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
	const { app } = get(plugin);
	const episodeMediaType = getEpisodeMediaType(episode);
	if (episodeMediaType !== "audio") {
		throw new Error("Transcription supports audio episodes only.");
	}
	const audioContainerHint = getAudioContainerHint(episode, episodeMediaType);

	if (isLocalFile(episode)) {
		const localFilePath = resolveLocalEpisodeFilePath(episode);
		if (!localFilePath) {
			throw new Error(
				`Unable to locate the local audio file for "${episode.title}". Try playing the file again.`,
			);
		}

		return readVaultAudio(localFilePath, episodeMediaType);
	}

	// Reuse a previously downloaded file only when the registry entry is the SAME
	// episode. The registry is keyed by podcastName+title, which two distinct
	// episodes can share (re-releases, placeholder titles), so also require the
	// stream source to match before trusting the cached bytes. Comparison is by
	// origin+path so a rotated signed-CDN query token (?token=...) still hits the
	// cache; a genuinely different episode has a different path and falls through
	// to a fresh fetch — correct, just not cached.
	const registered = downloadedEpisodes.getEpisode(episode);
	if (registered?.filePath && isSameMediaSource(registered.streamUrl, episode.streamUrl)) {
		const registeredMediaType = getEpisodeMediaTypeWithContainerHint(
			registered,
			audioContainerHint,
		);
		if (registeredMediaType !== "audio") {
			throw new Error("Transcription supports audio episodes only.");
		}

		const existingFile = app.vault.getAbstractFileByPath(registered.filePath);
		if (existingFile instanceof TFile) {
			return readVaultAudio(registered.filePath, registeredMediaType);
		}
	}

	try {
		const { data, contentType } = await downloadFile(episode.streamUrl);
		const inferredExtension = inferFileExtensionFromDownload(episode, data, contentType);
		if (!downloadAppearsAudio(contentType, inferredExtension, audioContainerHint)) {
			throw new Error(
				`The downloaded file is not audio (received "${contentType}"). The episode may be unavailable or require re-authentication.`,
			);
		}

		return {
			buffer: data,
			extension: normalizeAudioExtension(inferredExtension, audioContainerHint) ?? "mp3",
			basename: replaceIllegalFileNameCharactersInString(episode.title) || "episode",
		};
	} catch (error: unknown) {
		throw new Error(`Failed to fetch ${episode.title}: ${getErrorMessage(error)}`);
	}
}

function getAudioContainerHint(
	episode: Episode,
	episodeMediaType: EpisodeMediaType,
): EpisodeMediaType | undefined {
	if (episodeMediaType !== "audio") return undefined;
	if (episode.mediaType === "audio") return "audio";

	return isAudioContainerExtension(getUrlExtension(episode.streamUrl)) ? "audio" : undefined;
}

async function readVaultAudio(
	filePath: string,
	mediaTypeHint?: EpisodeMediaType,
): Promise<{ buffer: ArrayBuffer; extension: string; basename: string }> {
	const { app } = get(plugin);
	const file = app.vault.getAbstractFileByPath(filePath);
	if (!(file instanceof TFile)) {
		throw new Error(`Unable to read the audio file at "${filePath}".`);
	}

	const fileExtension = file.extension || getUrlExtension(file.path || filePath) || "";
	const explicitAudioContainer =
		mediaTypeHint === "audio" &&
		(fileExtension.toLowerCase() === "mp4" || fileExtension.toLowerCase() === "webm");
	const mediaType = explicitAudioContainer
		? "audio"
		: (getMediaTypeFromExtension(fileExtension) ?? getMediaTypeFromPath(file.path || filePath));
	if (mediaType !== "audio") {
		throw new Error(`Unable to read the non-audio file at "${filePath}".`);
	}

	const buffer = await app.vault.readBinary(file);
	return {
		buffer,
		extension:
			mediaTypeHint === "audio" && fileExtension.toLowerCase() === "mp4"
				? "m4a"
				: fileExtension,
		basename: file.basename || getFileBasename(file.path || filePath),
	};
}

function getFileBasename(filePath: string): string {
	const fileName = filePath.split("/").pop() ?? filePath;
	const dot = fileName.lastIndexOf(".");
	return dot > 0 ? fileName.slice(0, dot) : fileName;
}

// Binary signature detection lives in ./download/mediaSignatures
// (detectAudioFileExtension), imported above.
