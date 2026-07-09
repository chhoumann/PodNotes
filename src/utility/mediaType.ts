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

export const VIDEO_MEDIA_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "ogv"]);

export const PLAYABLE_MEDIA_EXTENSIONS = new Set([
	...AUDIO_MEDIA_EXTENSIONS,
	...VIDEO_MEDIA_EXTENSIONS,
]);

export function getMediaTypeFromExtension(extension?: string | null): EpisodeMediaType | null {
	if (!extension) return null;

	const normalizedExtension = extension.toLowerCase();
	if (VIDEO_MEDIA_EXTENSIONS.has(normalizedExtension)) return "video";
	if (AUDIO_MEDIA_EXTENSIONS.has(normalizedExtension)) return "audio";

	return null;
}

export function isPlayableMediaExtension(extension?: string | null): boolean {
	return getMediaTypeFromExtension(extension) !== null;
}

export function getMediaTypeFromContentType(contentType?: string | null): EpisodeMediaType | null {
	if (!contentType) return null;

	const normalizedType = contentType.split(";")[0].trim().toLowerCase();
	if (normalizedType.startsWith("video/")) return "video";
	if (normalizedType.startsWith("audio/")) return "audio";

	return null;
}

export function getMediaTypeFromPath(pathOrUrl?: string | null): EpisodeMediaType | null {
	if (!pathOrUrl) return null;

	return getMediaTypeFromExtension(getUrlExtension(pathOrUrl));
}

export function getUnambiguousMediaTypeFromPath(
	pathOrUrl?: string | null,
): EpisodeMediaType | null {
	if (!pathOrUrl) return null;

	const extension = getUrlExtension(pathOrUrl);
	if (isAudioContainerExtension(extension)) return null;

	return getMediaTypeFromExtension(extension);
}

export function getEpisodeMediaType(episode: Episode): EpisodeMediaType {
	if (episode.mediaType) return episode.mediaType;

	const filePath = (episode as Partial<LocalEpisode>).filePath;
	const filePathMediaType = getUnambiguousMediaTypeFromPath(filePath);
	if (filePathMediaType) return filePathMediaType;

	return getUnambiguousMediaTypeFromPath(episode.streamUrl) ?? "audio";
}

export function isAudioContainerExtension(extension?: string | null): boolean {
	if (!extension) return false;

	const normalizedExtension = extension.toLowerCase();
	return normalizedExtension === "mp4" || normalizedExtension === "webm";
}

export function getEpisodeMediaTypeWithContainerHint(
	episode: Episode,
	mediaTypeHint?: EpisodeMediaType,
): EpisodeMediaType {
	if (episode.mediaType) return episode.mediaType;

	const filePath = (episode as Partial<LocalEpisode>).filePath;
	const fileExtension = filePath ? getUrlExtension(filePath) : null;
	if (mediaTypeHint && isAudioContainerExtension(fileExtension)) {
		return mediaTypeHint;
	}

	return getEpisodeMediaType(episode);
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

		if (ua.search === ub.search) return true;

		const stableA = stableSearchParamEntries(ua.searchParams);
		const stableB = stableSearchParamEntries(ub.searchParams);
		if (stableSearchParamEntriesMatch(stableA, stableB)) return true;

		const pathIdentifiesMedia =
			getMediaTypeFromPath(ua.pathname) !== null ||
			getMediaTypeFromPath(ub.pathname) !== null;
		return pathIdentifiesMedia && stableA.length === 0 && stableB.length === 0;
	} catch {
		return false;
	}
}

function stableSearchParamEntriesMatch(stableA: string[], stableB: string[]): boolean {
	if (stableA.length === 0 || stableB.length === 0) return false;
	if (stableA.length !== stableB.length) return false;

	return stableA.every((entry, index) => entry === stableB[index]);
}

function stableSearchParamEntries(searchParams: URLSearchParams): string[] {
	return Array.from(searchParams.entries())
		.filter(([key]) => !isVolatileMediaSearchParam(key))
		.map(([key, value]) => `${key.toLowerCase()}=${value}`)
		.sort();
}

function isVolatileMediaSearchParam(key: string): boolean {
	const normalizedKey = key.toLowerCase();
	return (
		normalizedKey === "token" ||
		normalizedKey === "access_token" ||
		normalizedKey === "auth" ||
		normalizedKey === "authorization" ||
		normalizedKey === "signature" ||
		normalizedKey === "sig" ||
		normalizedKey === "expires" ||
		normalizedKey === "expiry" ||
		normalizedKey === "exp" ||
		normalizedKey === "policy" ||
		normalizedKey === "key-pair-id" ||
		normalizedKey.startsWith("x-amz-")
	);
}
