import { Notice, type App } from "obsidian";
import { get, type Readable } from "svelte/store";
import { PLAYED_SETTINGS } from "src/constants";
import {
	favorites,
	localFiles,
	playedEpisodes,
	playlists,
	queue,
	savedFeeds,
	type QueuePlacement,
} from "src/store";
import type { Episode } from "src/types/Episode";
import type { PodcastFeed } from "src/types/PodcastFeed";
import { askText } from "src/ui/TextPrompt";
import { noticeWithUndo } from "src/ui/undoNotice";
import checkStringIsUrl from "src/utility/checkStringIsUrl";
import { isSameStoredEpisode } from "src/utility/episodeKey";
import { ownRecord } from "src/utility/ownRecord";
import { isCredentialBearingUrl } from "src/utility/privateFeedUrl";
import type { FeedKey, FeedRepository } from "./FeedRepository";
import type { FeedUrlRepository } from "./FeedUrlRepository";
import {
	findSavedFeed,
	internPrivateFeed,
	notifyPrivateFeedUnavailable,
	publicFeedUrl,
	resolveFeedUrl,
	setPrivateFeedAddress,
} from "./privateFeeds";

/**
 * Every change the view makes to the library, with its rules. The view reads
 * the library through its services and changes it only here.
 */
export interface LibraryActions {
	/** The key of the saved feed at `url`. A private feed matches its real address too. */
	savedKey(feeds: Record<FeedKey, PodcastFeed>, url: string): FeedKey | undefined;
	/** Saves the feed and returns its key, or tells the user why not and returns null. */
	addPodcast(feed: PodcastFeed): FeedKey | null;
	/**
	 * Also forgets a private feed's address once no saved podcast uses it. Offers Undo,
	 * which puts the podcast back where it was, with its address, unless it was saved
	 * again since. Played records, downloads and the queue never left.
	 */
	removePodcast(key: FeedKey): void;
	/**
	 * Asks for a feed's address, checks that it loads, and keeps it under the same key.
	 * A private feed takes only a private address, kept on this device. A public feed
	 * takes any address not saved for another podcast; a private one is kept as a secret.
	 */
	setFeedAddress(key: FeedKey): Promise<void>;
	setQueued(episode: Episode, queued: boolean): void;
	/** Components may not import the queue store, so a gesture reorders it here. */
	reorderQueue(move: QueuePlacement): void;
	/** Empties the queue and offers Undo, which refills it while it is still empty. */
	clearQueue(): void;
	setFavorite(episode: Episode, favorite: boolean): void;
	setInPlaylist(name: string, episode: Episode, member: boolean): void;
	/**
	 * Asks for a name and creates a playlist, holding `episode` when one is given. The
	 * name, or null when the user cancels or the name is a built-in list's or taken.
	 */
	createPlaylist(episode?: Episode): Promise<string | null>;
	/** Deletes a playlist of the user's and offers Undo, which puts it back where it was. */
	deletePlaylist(name: string): void;
	/** `playedKey` names a Played record stored under another key than the episode's. */
	setPlayed(episode: Episode, played: boolean, playedKey?: string): void;
}

/** `record` with `value` under `key` at `index` of its entry order, the order lists show. */
function withEntryAt<T>(
	record: Record<string, T>,
	index: number,
	key: string,
	value: T,
): Record<string, T> {
	const entries = Object.entries(record);
	entries.splice(index, 0, [key, value]);
	return ownRecord(Object.fromEntries(entries));
}

// The menu that asks for a state was built from an earlier read, so membership is
// set, never toggled: a repeated click changes nothing.
function withMember(episodes: Episode[], episode: Episode, member: boolean): Episode[] {
	const others = episodes.filter((entry) => !isSameStoredEpisode(entry, episode));
	if (!member) return others;
	return others.length < episodes.length ? episodes : [...episodes, episode];
}

export function createLibraryActions({
	app,
	feeds,
	feedUrls,
	online,
}: {
	app: App;
	feeds: FeedRepository;
	feedUrls: FeedUrlRepository;
	online: Readable<boolean>;
}): LibraryActions {
	const savedKey = (saved: Record<FeedKey, PodcastFeed>, url: string) =>
		findSavedFeed(saved, url, feedUrls);

	const notStored = (title: string, error: unknown) => {
		console.error("PodNotes: could not store a private feed URL", error);
		new Notice(`Could not store the private feed address for "${title}" on this device.`);
	};

	return {
		savedKey,

		addPodcast(podcast) {
			const saved = get(savedFeeds);
			const existing = savedKey(saved, podcast.url);
			if (existing !== undefined) return existing;
			// A namesake must never replace a saved feed. A saved private feed whose
			// URL is missing on this device cannot be compared, so say that instead.
			const namesake = ownRecord(saved)[podcast.title];
			if (namesake) {
				if (resolveFeedUrl(namesake, feedUrls) === null) {
					notifyPrivateFeedUnavailable(namesake.title);
				} else {
					new Notice(
						`You already follow a podcast called ${podcast.title} from another feed.`,
					);
				}
				return null;
			}
			// A pasted private feed URL must never reach persisted settings.
			let feed: PodcastFeed;
			try {
				feed = internPrivateFeed(podcast, feedUrls);
			} catch (error) {
				notStored(podcast.title, error);
				return null;
			}
			savedFeeds.update((all) => ({ ...all, [feed.title]: feed }));
			return feed.title;
		},

		removePodcast(key) {
			const all = get(savedFeeds);
			const removed = ownRecord(all)[key];
			if (!removed) return;
			const index = Object.keys(all).indexOf(key);
			const reference = removed.urlSecretId?.trim();
			// Read before the removal can forget it, for Undo.
			const address = reference ? feedUrls.resolve(reference) : null;
			savedFeeds.update((current) => {
				const rest = ownRecord(current);
				delete rest[key];
				if (
					reference &&
					!Object.values(rest).some((feed) => feed.urlSecretId?.trim() === reference)
				) {
					feedUrls.delete(reference);
				}
				return rest;
			});
			noticeWithUndo(`Removed ${removed.title}`, () => {
				const current = get(savedFeeds);
				if (ownRecord(current)[key] || savedKey(current, address ?? removed.url)) return;
				if (reference && address) {
					try {
						feedUrls.attach(reference, address);
					} catch (error) {
						notStored(removed.title, error);
						return;
					}
				}
				savedFeeds.update((now) => withEntryAt(now, index, key, removed));
			});
		},

		async setFeedAddress(key) {
			const feed = ownRecord(get(savedFeeds))[key];
			if (!feed) return;
			// A sync replaces every record, unchanged or not, so the podcast is the same one
			// while it stays in the library. Removed and followed again, even from the same
			// search result, it is another subscription.
			let left = false;
			const unsubscribe = savedFeeds.subscribe((all) => {
				if (!ownRecord(all)[key]) left = true;
			});
			const isPrivate = Boolean(feed.urlSecretId?.trim());
			const refusal = (address?: string): string | undefined => {
				if (left) return `${feed.title} was removed while its address was edited.`;
				const now = ownRecord(get(savedFeeds))[key];
				if (now.url !== feed.url || now.urlSecretId !== feed.urlSecretId)
					return `${feed.title} changed while its address was edited. Try again.`;
				if (!get(online)) return "Setting a feed address needs a connection.";
				if (address === undefined || isPrivate) return undefined;
				const saved = get(savedFeeds);
				const other = savedKey(saved, address);
				if (other !== undefined && other !== key)
					return `You already follow ${saved[other].title} at that address.`;
				return undefined;
			};
			try {
				let why = refusal();
				if (why) {
					new Notice(why);
					return;
				}
				const entered = await askText(app, {
					title: feed.title,
					label: "Feed address",
					cta: "Save",
					value: publicFeedUrl(feed),
				});
				if (entered === null) return;
				why = refusal();
				if (why) {
					new Notice(why);
					return;
				}
				const url = checkStringIsUrl(entered);
				if (url?.protocol !== "http:" && url?.protocol !== "https:") {
					new Notice("Enter the feed's http or https address.");
					return;
				}
				if (isPrivate && !isCredentialBearingUrl(url.href)) {
					new Notice("Enter a private feed address.");
					return;
				}
				why = refusal(url.href);
				if (why) {
					new Notice(why);
					return;
				}
				try {
					await feeds.channelAt({ url: url.href });
				} catch {
					// An error's text can carry the address, a secret.
					new Notice("Could not load the feed at that address.");
					return;
				}
				// A sync can also save the address for another podcast while it loads.
				why = refusal(url.href);
				if (why) {
					new Notice(why);
					return;
				}
				try {
					if (isPrivate) setPrivateFeedAddress(feed, url.href, feedUrls);
					else {
						// A private address pasted for a public feed is kept as a secret, never in
						// settings. The rest of the record is the one saved now, with a sync's changes.
						const current = ownRecord(get(savedFeeds))[key];
						const edited = internPrivateFeed(
							{ ...current, url: url.href },
							feedUrls,
							key,
						);
						savedFeeds.update((all) => ({ ...all, [key]: edited }));
					}
				} catch (error) {
					notStored(feed.title, error);
					return;
				}
				void feeds.load([key], "network");
			} finally {
				unsubscribe();
			}
		},

		setQueued: (episode, queued) => (queued ? queue.add(episode) : queue.remove(episode)),
		reorderQueue: (move) => queue.reorder(move),
		clearQueue() {
			const cleared = get(queue).episodes;
			if (cleared.length === 0) return;
			queue.update((list) => ({ ...list, episodes: [] }));
			noticeWithUndo("Queue cleared", () => {
				// Anything queued since, by the user or by playback, wins over the old queue.
				if (get(queue).episodes.length === 0)
					queue.update((list) => ({ ...list, episodes: cleared }));
			});
		},
		setFavorite: (episode, favorite) =>
			favorites.update((list) => ({
				...list,
				episodes: withMember(list.episodes, episode, favorite),
			})),
		setInPlaylist: (name, episode, member) =>
			playlists.update((all) => {
				const list = ownRecord(all)[name];
				return list
					? {
							...all,
							[name]: {
								...list,
								episodes: withMember(list.episodes, episode, member),
							},
						}
					: all;
			}),
		async createPlaylist(episode) {
			const name = await askText(app, {
				title: "New playlist",
				label: "Playlist name",
				placeholder: "Name",
				cta: "Create",
			});
			if (name === null) return null;
			// A built-in list's name would make a custom playlist's page show the built-in list.
			const builtIn = [get(queue), get(favorites), get(localFiles), PLAYED_SETTINGS];
			if (builtIn.some((list) => list.name === name)) {
				new Notice(`"${name}" is a reserved playlist name.`);
				return null;
			}
			if (ownRecord(get(playlists))[name]) {
				new Notice("A playlist with that name already exists.");
				return null;
			}
			playlists.update((all) => ({
				...all,
				[name]: {
					name,
					icon: "list-music",
					episodes: episode ? [episode] : [],
					shouldEpisodeRemoveAfterPlay: false,
					shouldRepeat: false,
				},
			}));
			return name;
		},
		deletePlaylist(name) {
			const all = get(playlists);
			const deleted = ownRecord(all)[name];
			if (!deleted) return;
			const index = Object.keys(all).indexOf(name);
			playlists.update((current) => {
				const rest = ownRecord(current);
				delete rest[name];
				return rest;
			});
			noticeWithUndo(`Deleted ${name}`, () => {
				if (ownRecord(get(playlists))[name]) return;
				playlists.update((current) => withEntryAt(current, index, name, deleted));
			});
		},
		setPlayed(episode, played, playedKey) {
			if (played) playedEpisodes.markAsPlayed(episode);
			else if (playedKey) playedEpisodes.markKeyAsUnplayed(playedKey);
			else playedEpisodes.markAsUnplayed(episode);
		},
	};
}
