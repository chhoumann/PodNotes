import type { Readable, Unsubscriber } from "svelte/store";
import { FAVORITES_SETTINGS, LOCAL_FILES_SETTINGS, QUEUE_SETTINGS } from "src/constants";
import type { IPodNotes } from "src/types/IPodNotes";
import type { IPodNotesSettings } from "src/types/IPodNotesSettings";
import {
	downloadedEpisodes,
	episodeListLimit,
	favorites,
	hidePlayedEpisodes,
	localFiles,
	playedEpisodes,
	playlists,
	queue,
	savedFeeds,
} from "src/store";
import { sanitizeEpisodeListLimit } from "src/utility/episodeListLimit";

/**
 * A type-erased rule for mirroring one Svelte store into plugin settings. The
 * concrete value type is captured by {@link bind}; everything downstream operates
 * on `unknown` so a single subscribe/persist loop can drive every store.
 */
interface PersistenceBinding {
	subscribe: (handler: (value: unknown) => void) => Unsubscriber;
	apply: (settings: IPodNotesSettings, value: unknown) => void;
	shouldPersist?: (settings: IPodNotesSettings, value: unknown) => boolean;
}

/**
 * Captures a store and its settings-write in a type-erased binding. `apply` (and
 * the optional `shouldPersist` guard) are written against the store's real value
 * type `T`; the casts here are safe because the same store feeds both.
 */
function bind<T>(
	store: Readable<T>,
	apply: (settings: IPodNotesSettings, value: T) => void,
	shouldPersist?: (settings: IPodNotesSettings, value: T) => boolean,
): PersistenceBinding {
	return {
		subscribe: (handler) => store.subscribe((value) => handler(value)),
		apply: (settings, value) => apply(settings, value as T),
		shouldPersist: shouldPersist
			? (settings, value) => shouldPersist(settings, value as T)
			: undefined,
	};
}

/**
 * The single source of truth for how persisted stores map onto settings.
 *
 * Replaces the former per-store StoreController classes: every store followed the
 * same "on change, write the value into settings, then save" shape, so the only
 * thing worth stating per store is the settings field it writes — and the few
 * exceptions (forcing a built-in playlist's name/icon, skipping a no-op write).
 */
const BINDINGS: PersistenceBinding[] = [
	bind(playedEpisodes, (settings, value) => {
		settings.playedEpisodes = value;
	}),
	bind(savedFeeds, (settings, value) => {
		settings.savedFeeds = value;
	}),
	bind(playlists, (settings, value) => {
		settings.playlists = value;
	}),
	// The built-in playlists force their canonical name/icon on save so a renamed
	// or malformed persisted value can't drift the playlist's identity.
	bind(queue, (settings, value) => {
		settings.queue = { ...value, ...QUEUE_SETTINGS };
	}),
	bind(favorites, (settings, value) => {
		settings.favorites = { ...value, ...FAVORITES_SETTINGS };
	}),
	bind(localFiles, (settings, value) => {
		settings.localFiles = { ...value, ...LOCAL_FILES_SETTINGS };
	}),
	bind(downloadedEpisodes, (settings, value) => {
		settings.downloadedEpisodes = value;
	}),
	bind(
		hidePlayedEpisodes,
		(settings, value) => {
			settings.hidePlayedEpisodes = value;
		},
		// A primitive store: a no-op write would still churn saveSettings, so only
		// persist a genuine change.
		(settings, value) => settings.hidePlayedEpisodes !== value,
	),
];

const IMPORT_ROLLBACK_BINDINGS: PersistenceBinding[] = [
	...BINDINGS,
	// The limit control owns both this store and the persisted setting. It lives
	// outside BINDINGS because changing it also rebuilds the Latest Episodes list.
	bind(episodeListLimit, (settings, value) => {
		settings.episodeListLimit = sanitizeEpisodeListLimit(value);
	}),
];

type PlayerSettings = Partial<Pick<IPodNotesSettings, "currentEpisode">>;
const playerSettingsRecorders = new Set<(written: PlayerSettings) => void>();

export function writePlayerSettings(
	plugin: Pick<IPodNotes, "settings" | "saveSettings">,
	written: PlayerSettings,
): void {
	Object.assign(plugin.settings, written);
	for (const record of playerSettingsRecorders) record(structuredClone(written));
	void plugin.saveSettings();
}

export interface PersistedStoreChangeReplay {
	replayInto: (settings: IPodNotesSettings) => void;
	dispose: () => void;
}

/**
 * Record authoritative store emissions and the player's settings writes while
 * an import candidate is being written. Replaying only what changed avoids stale
 * snapshots and solves the ABA case where the new value already equals the import
 * candidate, so the normal persistence binding intentionally performs no settings
 * write.
 */
export function observePersistedStoreChanges(): PersistedStoreChangeReplay {
	const latestValues = new Map<PersistenceBinding, unknown>();
	const unsubscribers = IMPORT_ROLLBACK_BINDINGS.map((binding) => {
		let receivedInitialValue = false;
		return binding.subscribe((value) => {
			if (!receivedInitialValue) {
				receivedInitialValue = true;
				return;
			}

			latestValues.set(binding, structuredClone(value));
		});
	});
	const playerWrites: PlayerSettings = {};
	const recordPlayerWrite = (written: PlayerSettings) => Object.assign(playerWrites, written);
	playerSettingsRecorders.add(recordPlayerWrite);
	let disposed = false;

	return {
		replayInto(settings) {
			for (const [binding, value] of latestValues) {
				binding.apply(settings, structuredClone(value));
			}
			Object.assign(settings, structuredClone(playerWrites));
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const unsubscribe of unsubscribers) unsubscribe();
			playerSettingsRecorders.delete(recordPlayerWrite);
			latestValues.clear();
		},
	};
}

/**
 * Subscribes every persisted store to plugin settings and returns a single
 * unsubscriber that tears all of them down. Svelte fires each subscription
 * immediately with the current value, so the live settings object is backfilled
 * on bind; `saveSettings()` no-ops until the plugin marks itself ready.
 */
export function bindStoresToSettings(plugin: IPodNotes): Unsubscriber {
	const unsubscribers = BINDINGS.map((binding) =>
		binding.subscribe((value) => {
			if (binding.shouldPersist && !binding.shouldPersist(plugin.settings, value)) {
				return;
			}

			binding.apply(plugin.settings, value);
			void plugin.saveSettings();
		}),
	);

	return () => {
		for (const unsubscribe of unsubscribers) unsubscribe();
	};
}
