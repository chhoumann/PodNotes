import { DEFAULT_SETTINGS } from "src/constants";
import type { Episode } from "src/types/Episode";
import { getEpisodeKey } from "src/utility/episodeKey";
import { isPlainObject, type UnknownRecord } from "./codecUtils";
import { toDocument } from "./podNotesData";

/**
 * Structural equality for JSON-like settings values. Key order does not matter;
 * array order does. Used to decide which side of a 3-way merge "changed".
 */
export function jsonValuesEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a === null || b === null) return a === b;
	if (typeof a !== typeof b) return false;

	if (Array.isArray(a) || Array.isArray(b)) {
		if (!Array.isArray(a) || !Array.isArray(b)) return false;
		if (a.length !== b.length) return false;
		return a.every((item, index) => jsonValuesEqual(item, b[index]));
	}

	if (typeof a === "object" && typeof b === "object") {
		const aRecord = a as UnknownRecord;
		const bRecord = b as UnknownRecord;
		const aKeys = Object.keys(aRecord);
		const bKeys = Object.keys(bRecord);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every(
			(key) =>
				Object.prototype.hasOwnProperty.call(bRecord, key) &&
				jsonValuesEqual(aRecord[key], bRecord[key]),
		);
	}

	return false;
}

type EpisodeEntry = UnknownRecord & { title: string };

/** An entry that has an episode key: its title, and its podcast name if any, are text. */
function isEpisodeEntry(value: unknown): value is EpisodeEntry {
	return (
		isPlainObject(value) &&
		typeof value.title === "string" &&
		(value.podcastName === undefined || typeof value.podcastName === "string")
	);
}

/** The identity played state and downloads use, so same-titled episodes of two podcasts stay apart. */
function episodeEntryKey(entry: EpisodeEntry): string {
	return getEpisodeKey(entry as unknown as Episode);
}

const BUILT_IN_PLAYLISTS = new Set(["queue", "favorites", "localFiles"]);

/** Paths of a playlist's own field, so a user's playlist or podcast name never matches. */
function isPlaylistField(path: readonly string[], field: string): boolean {
	return (
		(path.length === 2 && BUILT_IN_PLAYLISTS.has(path[0]) && path[1] === field) ||
		(path.length === 3 && path[0] === "playlists" && path[2] === field)
	);
}

/** Playlist episode lists (queue, favorites, local files, custom playlists) and per-podcast downloads. */
function isEpisodeListPath(path: readonly string[]): boolean {
	return (
		isPlaylistField(path, "episodes") || (path.length === 2 && path[0] === "downloadedEpisodes")
	);
}

/** Maps whose entries are records: progress, saved feeds and note mappings. */
const ATOMIC_ENTRY_MAPS = new Set(["playedEpisodes", "savedFeeds", "podNotes"]);

/**
 * Values taken whole from local when both sides changed them. A per-field merge
 * of two different current episodes, of two progress records for one episode, of
 * two versions of one saved feed, or of two versions of one episode entry in a
 * list, yields a record no device wrote: one episode's title with another's
 * podcast, one device's position with the other's `finished`, one device's feed
 * URL with the other's private feed secret, or one source's stream URL with
 * another's file path.
 */
function isAtomicPath(path: readonly string[]): boolean {
	return (
		(path.length === 1 && path[0] === "currentEpisode") ||
		isPlaylistField(path, "currentEpisode") ||
		(path.length === 2 && ATOMIC_ENTRY_MAPS.has(path[0]))
	);
}

function indexByKey(items: EpisodeEntry[]): Map<string, EpisodeEntry> {
	const map = new Map<string, EpisodeEntry>();
	for (const item of items) {
		const key = episodeEntryKey(item);
		if (key && !map.has(key)) map.set(key, item);
	}
	return map;
}

/** A value whose fields only make sense together: an unchanged side yields, else local wins. */
function mergeWhole<T>(base: T, local: T, disk: T): T {
	return structuredClone(jsonValuesEqual(local, base) ? disk : local);
}

/**
 * Three-way merge of episode lists keyed by episode identity. Local order is
 * preserved; disk-only additions are appended. Local deletions win over
 * disk-only edits of the same key (same prefer-local conflict policy as leaf
 * merges). An entry both sides changed is taken whole from local. An untitled
 * episode has no key: local ones stay in place and disk-only ones are dropped.
 */
function threeWayMergeEpisodeList(
	base: EpisodeEntry[],
	local: EpisodeEntry[],
	disk: EpisodeEntry[],
): unknown[] {
	const baseMap = indexByKey(base);
	const diskMap = indexByKey(disk);
	const result: unknown[] = [];
	const seen = new Set<string>();

	for (const item of local) {
		const key = episodeEntryKey(item);
		if (!key) {
			result.push(structuredClone(item));
			continue;
		}
		if (seen.has(key)) continue;
		seen.add(key);

		const baseItem = baseMap.get(key);
		const diskItem = diskMap.get(key);

		if (!diskItem) {
			// Keep local additions and local edits that conflict with disk deletion.
			if (!baseItem || !jsonValuesEqual(item, baseItem)) {
				result.push(structuredClone(item));
			}
			continue;
		}

		result.push(mergeWhole(baseItem, item, diskItem));
	}

	for (const item of disk) {
		const key = episodeEntryKey(item);
		if (!key || seen.has(key)) continue;
		seen.add(key);

		// Local keys were already marked seen. Only disk-only additions survive;
		// keys present in base but absent locally were deliberately deleted.
		if (!baseMap.has(key)) result.push(structuredClone(item));
	}

	return result;
}

/**
 * Three-way merge for PodNotes data (and nested JSON-like values).
 *
 * - If local is unchanged from base, take disk (preserves other devices' edits).
 * - If disk is unchanged from base, take local (preserves in-memory edits).
 * - If both changed a `currentEpisode`, a progress record, a saved feed or a note
 *   mapping, take local whole.
 * - If both changed, or both added, the same plain object, recurse per key.
 * - Episode lists merge by episode key.
 * - Other irreducible array/leaf conflicts prefer local.
 */
export function threeWayMergeSettings<T>(
	base: T,
	local: T,
	disk: T,
	path: readonly string[] = [],
): T {
	if (jsonValuesEqual(local, disk)) return structuredClone(local);
	if (jsonValuesEqual(local, base)) return structuredClone(disk);
	if (jsonValuesEqual(disk, base)) return structuredClone(local);
	if (isAtomicPath(path)) return mergeWhole(base, local, disk);

	if (
		(base === undefined || isPlainObject(base)) &&
		isPlainObject(local) &&
		isPlainObject(disk)
	) {
		const ancestor: UnknownRecord = base ?? {};
		const keys = new Set([
			...Object.keys(ancestor),
			...Object.keys(local),
			...Object.keys(disk),
		]);
		const merged: UnknownRecord = {};
		for (const key of keys) {
			const value = threeWayMergeSettings(ancestor[key], local[key], disk[key], [
				...path,
				key,
			]);
			// JSON has no undefined: a merged-away key must be absent, or the
			// written document never equals the same document read back.
			if (value !== undefined) merged[key] = value;
		}
		return merged as T;
	}

	if (Array.isArray(local) && Array.isArray(disk) && isEpisodeListPath(path)) {
		const baseList: unknown[] = Array.isArray(base) ? base : [];
		if (
			local.every(isEpisodeEntry) &&
			disk.every(isEpisodeEntry) &&
			baseList.every(isEpisodeEntry)
		) {
			return threeWayMergeEpisodeList(baseList, local, disk) as T;
		}
	}

	// Other arrays and primitives: both sides diverged, keep the in-memory edit.
	return structuredClone(local);
}

/**
 * Memory `local` merged with the file `disk`, given `base`, the file this device
 * last loaded or wrote. A file whose `libraryId` differs from base's is another
 * library, started on a device that never saw this one's file: the two merge from
 * the empty library, so every entry of both survives, a preference one side left
 * at its default takes the other's, and a real conflict keeps this device's. The
 * result keeps the `libraryId` of the library started first, so that library's
 * devices go on merging three ways.
 */
export function mergeDataFile<T>(base: T, local: T, disk: T): T {
	const lineage = (doc: T) => (doc as UnknownRecord).libraryId as string;
	if (lineage(base) === lineage(disk)) return threeWayMergeSettings(base, local, disk);

	const empty = toDocument(DEFAULT_SETTINGS) as T;
	const merged = threeWayMergeSettings(empty, local, disk) as UnknownRecord;
	// Memory, not base: memory may already hold a library that started earlier.
	merged.libraryId = [lineage(local), lineage(disk)].sort()[0];
	return merged as T;
}

/**
 * `disk` with the entries the codec dropped while reading `raw` put back from
 * `base`: map entries, and episode list entries by episode key. A dropped entry
 * is not a deletion on the other device; an entry `raw` lacks is. An entry that
 * is still there is taken from disk whole.
 */
export function restoreDropped<T>(base: T, disk: T, raw: unknown, path: readonly string[]): T {
	if (disk === undefined) return structuredClone(base);
	if (isAtomicPath(path)) return disk;

	if (isPlainObject(base) && isPlainObject(disk)) {
		// Not an object: the codec replaced the whole value, so every entry was dropped.
		const rawEntries = isPlainObject(raw) ? raw : {};
		const restored: UnknownRecord = { ...disk };
		for (const [key, value] of Object.entries(base)) {
			if (key in disk) {
				restored[key] = restoreDropped(value, disk[key], rawEntries[key], [...path, key]);
			} else if (!isPlainObject(raw) || key in raw) {
				restored[key] = structuredClone(value);
			}
		}
		return restored as T;
	}

	if (
		Array.isArray(base) &&
		Array.isArray(disk) &&
		isEpisodeListPath(path) &&
		base.every(isEpisodeEntry) &&
		disk.every(isEpisodeEntry)
	) {
		const kept = new Set(disk.map(episodeEntryKey));
		const rawList: unknown[] = Array.isArray(raw) ? raw : [];
		const rawKeys = new Set(rawList.filter(isEpisodeEntry).map(episodeEntryKey));
		// An entry the codec dropped or repaired for its title or podcast name has no
		// key: any missing one may be it.
		const droppedUnkeyed = !Array.isArray(raw) || rawList.some((item) => !isEpisodeEntry(item));
		const dropped = base.filter((entry) => {
			const key = episodeEntryKey(entry);
			return !kept.has(key) && (rawKeys.has(key) || droppedUnkeyed);
		});
		return [...disk, ...structuredClone(dropped)] as T;
	}

	return disk;
}
