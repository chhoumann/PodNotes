import type { Episode, EpisodeMediaType } from "src/types/Episode";
import type { LocalEpisode } from "src/types/LocalEpisode";
import getUrlExtension from "./getUrlExtension";

export const AUDIO_MEDIA_EXTENSIONS = new Set([
	"mp3",
	"m4a",
	"aac",
	"ogg",
	"wav",
	"flac",
	"wma",
	"amr",
]);

export const VIDEO_MEDIA_EXTENSIONS = new Set([
	"mp4",
	"m4v",
	"mov",
	"webm",
	"ogv",
]);

export const PLAYABLE_MEDIA_EXTENSIONS = new Set([
	...AUDIO_MEDIA_EXTENSIONS,
	...VIDEO_MEDIA_EXTENSIONS,
]);

export function getMediaTypeFromExtension(
	extension?: string | null,
): EpisodeMediaType | null {
	if (!extension) return null;

	const normalizedExtension = extension.toLowerCase();
	if (VIDEO_MEDIA_EXTENSIONS.has(normalizedExtension)) return "video";
	if (AUDIO_MEDIA_EXTENSIONS.has(normalizedExtension)) return "audio";

	return null;
}

export function isPlayableMediaExtension(extension?: string | null): boolean {
	return getMediaTypeFromExtension(extension) !== null;
}

export function getMediaTypeFromContentType(
	contentType?: string | null,
): EpisodeMediaType | null {
	if (!contentType) return null;

	const normalizedType = contentType.split(";")[0].trim().toLowerCase();
	if (normalizedType.startsWith("video/")) return "video";
	if (normalizedType.startsWith("audio/")) return "audio";

	return null;
}

export function getMediaTypeFromPath(
	pathOrUrl?: string | null,
): EpisodeMediaType | null {
	if (!pathOrUrl) return null;

	return getMediaTypeFromExtension(getUrlExtension(pathOrUrl));
}

export function getEpisodeMediaType(episode: Episode): EpisodeMediaType {
	const filePath = (episode as Partial<LocalEpisode>).filePath;
	const filePathMediaType = getMediaTypeFromPath(filePath);
	if (filePathMediaType) return filePathMediaType;

	if (episode.mediaType) return episode.mediaType;

	return getMediaTypeFromPath(episode.streamUrl) ?? "audio";
}

export function isSameMediaSource(a: string, b: string): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	try {
		const ua = new URL(a);
		const ub = new URL(b);
		if (ua.origin !== ub.origin || ua.pathname !== ub.pathname) {
			return false;
		}

		const pathIdentifiesMedia =
			getMediaTypeFromPath(ua.pathname) !== null ||
			getMediaTypeFromPath(ub.pathname) !== null;
		return pathIdentifiesMedia || ua.search === ub.search;
	} catch {
		return false;
	}
}
