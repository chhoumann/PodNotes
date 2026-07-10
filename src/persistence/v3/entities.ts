import { isEpisodeHandle, isFeedHandle, type EpisodeHandle } from "src/security/resourceHandles";
import { isFeedCapabilityReferenceFor } from "src/security/feedCapabilityReferences";
import {
	MAX_AUTHOR_BYTES,
	MAX_COLLECTION_ID_BYTES,
	MAX_CONTENT_TEXT_BYTES,
	MAX_DESCRIPTION_TEXT_BYTES,
	MAX_ICON_BYTES,
	MAX_PLAYLIST_EPISODE_REFERENCES,
	MAX_PLAYLIST_NAME_BYTES,
	MAX_TITLE_BYTES,
	MAX_TOTAL_EPISODE_REFERENCES,
	type LibraryEpisodeV3,
	type LibraryFeedV3,
	type LibraryPlaylistV3,
	type ValidationContext,
} from "./model";
import {
	INVALID,
	hasOwn,
	isPlainDataRecord,
	isStrictRecord,
	normalizeText,
	optionalDate,
	optionalNonNegativeNumber,
	optionalText,
} from "./scalars";

const REMOTE_FEED_KEYS = new Set([
	"feedId",
	"kind",
	"capabilityRef",
	"title",
	"collectionId",
	"author",
	"descriptionText",
]);
const LOCAL_FEED_KEYS = new Set([
	"feedId",
	"kind",
	"title",
	"collectionId",
	"author",
	"descriptionText",
]);
const EPISODE_KEYS = new Set([
	"episodeId",
	"feedId",
	"kind",
	"title",
	"descriptionText",
	"contentText",
	"episodeDate",
	"itunesTitle",
	"episodeNumber",
	"duration",
	"mediaType",
]);
const PLAYLIST_KEYS = new Set([
	"name",
	"icon",
	"episodeIds",
	"currentEpisodeId",
	"shouldEpisodeRemoveAfterPlay",
	"shouldRepeat",
]);

export function normalizeFeed(
	value: unknown,
	expectedFeedId: string,
	context: ValidationContext,
): LibraryFeedV3 | null {
	if (!isPlainDataRecord(value) || !isFeedHandle(expectedFeedId)) return null;
	if (value.kind !== "remote" && value.kind !== "local") return null;
	const allowedKeys = value.kind === "remote" ? REMOTE_FEED_KEYS : LOCAL_FEED_KEYS;
	if (!isStrictRecord(value, allowedKeys) || value.feedId !== expectedFeedId) return null;

	const title = normalizeText(value.title, MAX_TITLE_BYTES, context);
	const collectionId = optionalText(value, "collectionId", MAX_COLLECTION_ID_BYTES, context);
	const author = optionalText(value, "author", MAX_AUTHOR_BYTES, context);
	const descriptionText = optionalText(
		value,
		"descriptionText",
		MAX_DESCRIPTION_TEXT_BYTES,
		context,
		{ multiline: true, rejectHtml: true },
	);
	if (
		title === INVALID ||
		collectionId === INVALID ||
		author === INVALID ||
		descriptionText === INVALID
	) {
		return null;
	}

	const metadata = {
		feedId: expectedFeedId,
		title,
		...(collectionId ? { collectionId } : {}),
		...(author ? { author } : {}),
		...(descriptionText ? { descriptionText } : {}),
	};
	if (value.kind === "local") return { ...metadata, kind: "local" };
	if (!isFeedCapabilityReferenceFor(expectedFeedId, value.capabilityRef)) return null;
	return { ...metadata, kind: "remote", capabilityRef: value.capabilityRef };
}

export function normalizeEpisode(
	value: unknown,
	expectedEpisodeId: string,
	context: ValidationContext,
): LibraryEpisodeV3 | null {
	if (
		!isStrictRecord(value, EPISODE_KEYS) ||
		!isEpisodeHandle(expectedEpisodeId) ||
		value.episodeId !== expectedEpisodeId ||
		!isFeedHandle(value.feedId) ||
		(value.kind !== "remote" && value.kind !== "local")
	) {
		return null;
	}

	const title = normalizeText(value.title, MAX_TITLE_BYTES, context);
	const descriptionText = optionalText(
		value,
		"descriptionText",
		MAX_DESCRIPTION_TEXT_BYTES,
		context,
		{ multiline: true, rejectHtml: true },
	);
	const contentText = optionalText(value, "contentText", MAX_CONTENT_TEXT_BYTES, context, {
		multiline: true,
		rejectHtml: true,
	});
	const episodeDate = optionalDate(value, "episodeDate");
	const itunesTitle = optionalText(value, "itunesTitle", MAX_TITLE_BYTES, context);
	const episodeNumber = optionalNonNegativeNumber(value, "episodeNumber", true);
	const duration = optionalNonNegativeNumber(value, "duration", false);
	if (
		title === INVALID ||
		descriptionText === INVALID ||
		contentText === INVALID ||
		episodeDate === INVALID ||
		itunesTitle === INVALID ||
		episodeNumber === INVALID ||
		duration === INVALID ||
		(hasOwn(value, "mediaType") && value.mediaType !== "audio" && value.mediaType !== "video")
	) {
		return null;
	}

	return {
		episodeId: expectedEpisodeId,
		feedId: value.feedId,
		kind: value.kind,
		title,
		...(descriptionText ? { descriptionText } : {}),
		...(contentText ? { contentText } : {}),
		...(episodeDate ? { episodeDate } : {}),
		...(itunesTitle ? { itunesTitle } : {}),
		...(episodeNumber !== undefined ? { episodeNumber } : {}),
		...(duration !== undefined ? { duration } : {}),
		...(value.mediaType === "audio" || value.mediaType === "video"
			? { mediaType: value.mediaType }
			: {}),
	};
}

export function normalizePlaylist(
	value: unknown,
	context: ValidationContext,
): LibraryPlaylistV3 | null {
	if (!isStrictRecord(value, PLAYLIST_KEYS) || !Array.isArray(value.episodeIds)) return null;
	if (value.episodeIds.length > MAX_PLAYLIST_EPISODE_REFERENCES) return null;
	if (
		typeof value.shouldEpisodeRemoveAfterPlay !== "boolean" ||
		typeof value.shouldRepeat !== "boolean"
	) {
		return null;
	}

	const name = normalizeText(value.name, MAX_PLAYLIST_NAME_BYTES, context);
	const icon = normalizeText(value.icon, MAX_ICON_BYTES, context);
	if (name === INVALID || icon === INVALID) return null;

	const episodeIds: EpisodeHandle[] = [];
	const membership = new Set<string>();
	for (const episodeId of value.episodeIds) {
		if (!isEpisodeHandle(episodeId)) return null;
		membership.add(episodeId);
		episodeIds.push(episodeId);
	}
	context.episodeReferences += episodeIds.length;
	if (context.episodeReferences > MAX_TOTAL_EPISODE_REFERENCES) return null;

	let currentEpisodeId: EpisodeHandle | undefined;
	if (hasOwn(value, "currentEpisodeId")) {
		if (!isEpisodeHandle(value.currentEpisodeId) || !membership.has(value.currentEpisodeId)) {
			return null;
		}
		currentEpisodeId = value.currentEpisodeId;
		context.episodeReferences += 1;
		if (context.episodeReferences > MAX_TOTAL_EPISODE_REFERENCES) return null;
	}

	return {
		name,
		icon,
		episodeIds,
		...(currentEpisodeId ? { currentEpisodeId } : {}),
		shouldEpisodeRemoveAfterPlay: value.shouldEpisodeRemoveAfterPlay,
		shouldRepeat: value.shouldRepeat,
	};
}
