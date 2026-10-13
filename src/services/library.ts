import { Notice, type App } from "obsidian";
import { get } from "svelte/store";
import {
	favorites,
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
	/** Also forgets a private feed's address once no saved podcast uses it. */
	removePodcast(key: FeedKey): void;
	/** Asks for a saved private feed's address, checks that it loads, and keeps it on this device. */
	setFeedAddress(key: FeedKey): Promise<void>;
	setQueued(episode: Episode, queued: boolean): void;
	/** Components may not import the queue store, so a gesture reorders it here. */
	reorderQueue(move: QueuePlacement): void;
	/** Empties the queue and offers Undo, which refills it while it is still empty. */
	clearQueue(): void;
	setFavorite(episode: Episode, favorite: boolean): void;
	setInPlaylist(name: string, episode: Episode, member: boolean): void;
	/** `playedKey` names a Played record stored under another key than the episode's. */
	setPlayed(episode: Episode, played: boolean, playedKey?: string): void;
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
}: {
	app: App;
	feeds: FeedRepository;
	feedUrls: FeedUrlRepository;
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
			savedFeeds.update((all) => {
				const { [key]: removed, ...rest } = all;
				const reference = removed?.urlSecretId?.trim();
				if (
					reference &&
					!Object.values(rest).some((feed) => feed.urlSecretId?.trim() === reference)
				) {
					feedUrls.delete(reference);
				}
				return rest;
			});
		},

		async setFeedAddress(key) {
			const feed = ownRecord(get(savedFeeds))[key];
			if (!feed) return;
			const entered = await askText(app, {
				title: feed.title,
				label: "Feed address",
				cta: "Save",
			});
			if (entered === null) return;
			const url = checkStringIsUrl(entered);
			if (url?.protocol !== "http:" && url?.protocol !== "https:") {
				new Notice("Enter the feed's http or https address.");
				return;
			}
			if (!isCredentialBearingUrl(url.href)) {
				new Notice("Enter a private feed address.");
				return;
			}
			try {
				await feeds.channelAt({ url: url.href });
			} catch {
				// An error's text can carry the address, a secret.
				new Notice("Could not load the feed at that address.");
				return;
			}
			// A sync can replace the feed while its address loads.
			const current = ownRecord(get(savedFeeds))[key];
			if (!current || current.urlSecretId !== feed.urlSecretId) return;
			try {
				setPrivateFeedAddress(current, url.href, feedUrls);
			} catch (error) {
				notStored(feed.title, error);
				return;
			}
			void feeds.load([key], "network");
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
		setPlayed(episode, played, playedKey) {
			if (played) playedEpisodes.markAsPlayed(episode);
			else if (playedKey) playedEpisodes.markKeyAsUnplayed(playedKey);
			else playedEpisodes.markAsUnplayed(episode);
		},
	};
}
