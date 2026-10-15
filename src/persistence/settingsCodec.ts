import {
	DEFAULT_SETTINGS,
	FAVORITES_SETTINGS,
	LOCAL_FILES_SETTINGS,
	QUEUE_SETTINGS,
} from "src/constants";
import {
	migrateDownloadPath,
	migrateFeedNoteSettings,
	migrateNoteSettings,
	migrateSkipLength,
	migrateTranscriptSettings,
} from "src/settingsMigrations";
import { NEXT_TRACK_ACTIONS, PREVIOUS_TRACK_ACTIONS } from "src/types/Headset";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import { isPodNotesSecretId, type CredentialKind } from "src/types/Credentials";
import { sanitizeEpisodeListLimit } from "src/utility/episodeListLimit";
import { normalizePlaybackRate } from "src/utility/playbackRate";
import {
	decodeDownloadedEpisodes,
	decodePlayedEpisodes,
	decodePlaylists,
	decodePodNotes,
	decodeSavedFeeds,
} from "./collectionCodecs";
import {
	copySafeObject,
	optionalRecord,
	readBoolean,
	readClampedNumber,
	readFiniteNumber,
	readNullableString,
	readOption,
	readString,
	type UnknownRecord,
	warn,
} from "./codecUtils";
import { decodeEpisode, decodePlaylist } from "./episodeCodec";
import type { PodNotesDataSchemaVersion } from "./podNotesData";

export function decodeSettings(
	root: UnknownRecord,
	warnings: Set<string>,
	sourceVersion: PodNotesDataSchemaVersion = 2,
): IPodNotesSettings {
	const defaultPlaybackRate = decodeNormalized(
		root,
		"defaultPlaybackRate",
		normalizePlaybackRate,
		warnings,
	);

	const defaultVolume = readClampedNumber(
		root,
		"defaultVolume",
		DEFAULT_SETTINGS.defaultVolume,
		0,
		1,
		warnings,
	);
	const episodeListLimit = decodeNormalized(
		root,
		"episodeListLimit",
		sanitizeEpisodeListLimit,
		warnings,
	);

	return {
		savedFeeds: decodeSavedFeeds(root.savedFeeds, warnings),
		podNotes: decodePodNotes(root.podNotes, warnings),
		defaultPlaybackRate,
		defaultVolume,
		hidePlayedEpisodes: readBoolean(
			root,
			"hidePlayedEpisodes",
			DEFAULT_SETTINGS.hidePlayedEpisodes,
			warnings,
		),
		episodeListLimit,
		playedEpisodes: decodePlayedEpisodes(root.playedEpisodes, warnings),
		skipBackwardLength: decodeNormalized(
			root,
			"skipBackwardLength",
			(value) => migrateSkipLength(value, DEFAULT_SETTINGS.skipBackwardLength),
			warnings,
		),
		skipForwardLength: decodeNormalized(
			root,
			"skipForwardLength",
			(value) => migrateSkipLength(value, DEFAULT_SETTINGS.skipForwardLength),
			warnings,
		),
		headsetPreviousTrack: readOption(
			root,
			"headsetPreviousTrack",
			PREVIOUS_TRACK_ACTIONS,
			DEFAULT_SETTINGS.headsetPreviousTrack,
			warnings,
		),
		headsetNextTrack: readOption(
			root,
			"headsetNextTrack",
			NEXT_TRACK_ACTIONS,
			DEFAULT_SETTINGS.headsetNextTrack,
			warnings,
		),
		playlists: decodePlaylists(root.playlists, warnings),
		queue: decodePlaylist(root.queue, QUEUE_SETTINGS, warnings, "queue"),
		autoQueue: readBoolean(root, "autoQueue", DEFAULT_SETTINGS.autoQueue, warnings),
		favorites: decodePlaylist(root.favorites, FAVORITES_SETTINGS, warnings, "favorites"),
		localFiles: decodePlaylist(root.localFiles, LOCAL_FILES_SETTINGS, warnings, "localFiles"),
		currentEpisode:
			root.currentEpisode === undefined || root.currentEpisode === null
				? undefined
				: decodeEpisode(root.currentEpisode, warnings, "currentEpisode"),
		timestamp: decodeTimestamp(root.timestamp, warnings),
		note: decodeNote(root.note, warnings, sourceVersion),
		feedNote: decodeFeedNote(root.feedNote, warnings),
		download: decodeDownload(root.download, warnings),
		downloadedEpisodes: decodeDownloadedEpisodes(root.downloadedEpisodes, warnings),
		openAISecretId: decodeSecretId(root, "openAISecretId", warnings),
		deepgramSecretId: decodeSecretId(root, "deepgramSecretId", warnings),
		transcript: decodeTranscript(root.transcript, warnings),
	};
}

function decodeSecretId(
	root: UnknownRecord,
	key: "openAISecretId" | "deepgramSecretId",
	warnings: Set<string>,
): string {
	const value = readString(root, key, DEFAULT_SETTINGS[key], warnings);
	const kind: CredentialKind = key === "openAISecretId" ? "openai" : "deepgram";
	if (!value || isPodNotesSecretId(kind, value)) return value;

	warn(warnings, key, "foreign or wrong-provider SecretStorage ID; reference was removed");
	return "";
}

/**
 * The timestamp template before `{{linktime}}` became the default (#345).
 * PodNotes always writes the template, so data without one is older or
 * hand-edited and keeps the template it ran with.
 */
const LEGACY_TIMESTAMP_TEMPLATE = "- {{time}} ";

function decodeTimestamp(value: unknown, warnings: Set<string>): IPodNotesSettings["timestamp"] {
	const record = optionalRecord(value, warnings, "timestamp");
	return {
		...copySafeObject(record),
		template: readString(record, "template", LEGACY_TIMESTAMP_TEMPLATE, warnings, "timestamp"),
		offset: readFiniteNumber(
			record,
			"offset",
			DEFAULT_SETTINGS.timestamp.offset,
			warnings,
			"timestamp",
		),
	};
}

function decodeNote(
	value: unknown,
	warnings: Set<string>,
	sourceVersion: PodNotesDataSchemaVersion,
): IPodNotesSettings["note"] {
	const record = optionalRecord(value, warnings, "note");
	const path = readNullableString(record, "path", warnings, "note");
	const template = readNullableString(record, "template", warnings, "note");
	const validated =
		sourceVersion === 0
			? migrateNoteSettings({ path, template })
			: {
					path: typeof path === "string" ? path : DEFAULT_SETTINGS.note.path,
					template:
						typeof template === "string" ? template : DEFAULT_SETTINGS.note.template,
				};
	return { ...copySafeObject(record), ...validated };
}

function decodeFeedNote(value: unknown, warnings: Set<string>): IPodNotesSettings["feedNote"] {
	const record = optionalRecord(value, warnings, "feedNote");
	const migrated = migrateFeedNoteSettings({
		path: readNullableString(record, "path", warnings, "feedNote"),
		template: readNullableString(record, "template", warnings, "feedNote"),
	});
	return { ...copySafeObject(record), ...migrated };
}

function decodeDownload(value: unknown, warnings: Set<string>): IPodNotesSettings["download"] {
	const record = optionalRecord(value, warnings, "download");
	return {
		...copySafeObject(record),
		path: migrateDownloadPath(readNullableString(record, "path", warnings, "download")),
	};
}

function decodeTranscript(value: unknown, warnings: Set<string>): IPodNotesSettings["transcript"] {
	const record = optionalRecord(value, warnings, "transcript");
	const diarization = optionalRecord(record.diarization, warnings, "transcript.diarization");
	const migrated = migrateTranscriptSettings({
		path: record.path as string | null | undefined,
		template: record.template as string | null | undefined,
		diarization,
	});

	if (record.path !== undefined && typeof record.path !== "string") {
		warn(warnings, "transcript.path", "expected a string");
	}
	if (record.template !== undefined && typeof record.template !== "string") {
		warn(warnings, "transcript.template", "expected a string");
	}
	if (diarization.enabled !== undefined && typeof diarization.enabled !== "boolean") {
		warn(warnings, "transcript.diarization.enabled", "expected a boolean");
	}
	if (
		diarization.provider !== undefined &&
		diarization.provider !== "openai" &&
		diarization.provider !== "deepgram"
	) {
		warn(warnings, "transcript.diarization.provider", "unknown provider");
	}
	if (
		diarization.speakerTemplate !== undefined &&
		typeof diarization.speakerTemplate !== "string"
	) {
		warn(warnings, "transcript.diarization.speakerTemplate", "expected a string");
	}

	return {
		...copySafeObject(record),
		...migrated,
		diarization: {
			...copySafeObject(diarization),
			...migrated.diarization,
		},
	};
}

/** The normalized number, with a warning when it differs from a stored value. */
function decodeNormalized(
	root: UnknownRecord,
	key: string,
	normalize: (value: unknown) => number,
	warnings: Set<string>,
): number {
	const value = root[key];
	const decoded = normalize(value);
	if (value !== undefined && value !== decoded) warn(warnings, key, "value was normalized");
	return decoded;
}
