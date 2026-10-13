import { Menu, Notice } from "obsidian";
import { get } from "svelte/store";
import createFeedNote, { getFeedNote, openFeedNote } from "src/createFeedNote";
import createPodcastNote, { openPodcastNote } from "src/createPodcastNote";
import downloadEpisodeWithNotice, { removeDownloadedEpisode } from "src/downloadEpisode";
import { downloadedCopy } from "src/player/source";
import type { FeedKey } from "src/services/FeedRepository";
import type { Episode } from "src/types/Episode";
import type { IconType } from "src/types/IconType";
import buildEpisodeResumeLink from "src/utility/buildEpisodeResumeLink";
import { isSameEpisode, isSameStoredEpisode } from "src/utility/episodeKey";
import { episodeLinkTarget } from "src/utility/episodeLinkTarget";
import { isEpisodeFinished } from "src/utility/episodeStatus";
import { isLocalFile } from "src/utility/isLocalFile";
import { isCredentialBearingUrl } from "src/utility/privateFeedUrl";
import type { ShellServices } from "./context";
import { isCurrentEpisode } from "./episodeRow";
import { buildQueueReorderMenuItems } from "./queueReorderMenu";

/** A menu item, or a separator. Menus are built as data, so tests read them as data. */
export type MenuEntry =
	| {
			readonly title: string;
			readonly icon: IconType;
			readonly checked?: boolean;
			readonly warning?: boolean;
			readonly disabled?: boolean;
			onClick(): void;
	  }
	| "separator";

/** Where a menu opens. The document is the one the pointer was in, which can be a popout's. */
export interface MenuAnchor {
	readonly x: number;
	readonly y: number;
	readonly doc: Document;
}

/** A right-click or long press opens the menu at the pointer, a button under itself. */
export function anchorOf(event: MouseEvent): MenuAnchor {
	const el = event.currentTarget as HTMLElement;
	if (event.type === "contextmenu") {
		event.preventDefault();
		return { x: event.clientX, y: event.clientY, doc: el.doc };
	}
	const { left, bottom } = el.getBoundingClientRect();
	return { x: left, y: bottom, doc: el.doc };
}

export function showMenu(entries: readonly MenuEntry[], at: MenuAnchor): void {
	const menu = new Menu();
	for (const entry of entries) {
		if (entry === "separator") {
			menu.addSeparator();
			continue;
		}
		menu.addItem((item) => {
			item.setTitle(entry.title).setIcon(entry.icon).onClick(entry.onClick);
			if (entry.checked) item.setChecked(true);
			if (entry.warning) item.setWarning(true);
			if (entry.disabled) item.setDisabled(true);
		});
	}
	menu.showAtPosition(at, at.doc);
}

export function openEpisode(
	{ player, navigation }: ShellServices,
	episode: Episode,
	available = true,
) {
	if (!available) {
		new Notice("This played episode is no longer available in current feeds.");
		return;
	}
	if (!isCurrentEpisode(get(player.state).episode, episode)) player.play(episode);
	navigation.expand();
}

export interface EpisodeMenuOptions {
	readonly place: "list" | "queue" | "player";
	readonly at: MenuAnchor;
	/** False for a Played record whose episode left every feed. */
	readonly available?: boolean;
	/** A Played record stored under another key than the episode's. */
	readonly playedKey?: string;
}

export function episodeMenu(
	episode: Episode,
	services: ShellServices,
	{ place, at, available = true, playedKey }: EpisodeMenuOptions,
): MenuEntry[] {
	const { library, actions, player, settings } = services;
	const item = (title: string, icon: IconType, onClick: () => void): MenuEntry => ({
		title,
		icon,
		onClick,
	});
	const played = get(library.playedEpisodes);
	const finished =
		(playedKey ? played[playedKey]?.finished : undefined) ?? isEpisodeFinished(episode, played);
	const markPlayed = item(finished ? "Mark as unplayed" : "Mark as played", "check", () =>
		actions.setPlayed(episode, !finished, playedKey),
	);
	if (!available) return [markPlayed];

	const queue = get(library.queue).episodes;
	const queued = queue.some((entry) => isSameEpisode(entry, episode));
	const favorite = get(library.favorites).episodes.some((entry) =>
		isSameStoredEpisode(entry, episode),
	);
	const downloaded = downloadedCopy(get(library.downloadedEpisodes), episode) !== undefined;
	const lists = Object.values(get(library.playlists));
	// An episode opened by a private feed's own address would put that secret in the link.
	const link = isCredentialBearingUrl(episodeLinkTarget(episode) ?? "")
		? ""
		: buildEpisodeResumeLink(episode);
	const entries: MenuEntry[] = [];

	if (place !== "player") {
		const current = isCurrentEpisode(get(player.state).episode, episode);
		entries.push(
			item(current ? "Open player" : "Play", "play", () => openEpisode(services, episode)),
		);
	}
	entries.push(
		item(queued ? "Remove from queue" : "Add to queue", "list-end", () =>
			actions.setQueued(episode, !queued),
		),
	);
	const moves = buildQueueReorderMenuItems(place === "queue", queue, episode);
	if (moves.length > 0) {
		entries.push(
			"separator",
			...moves.map(({ title, icon, kind }) =>
				item(title, icon, () => actions.moveInQueue(episode, kind)),
			),
		);
	}
	entries.push(
		"separator",
		services.hasNote(episode)
			? item("Open note", "file-text", () => openPodcastNote(episode))
			: item("Create note", "file-plus", () => {
					const { path, template } = get(settings).note;
					if (path && template) void createPodcastNote(episode);
					else new Notice("Please set a note path and template in the settings.");
				}),
	);
	if (isLocalFile(episode)) {
		if (downloaded) {
			// Removing a local file forgets it and never trashes it.
			entries.push(
				item(
					"Remove from Local Files",
					"trash",
					() => void removeDownloadedEpisode(episode),
				),
			);
		}
	} else if (downloaded) {
		entries.push(item("Remove download", "trash", () => void removeDownloadedEpisode(episode)));
	} else {
		entries.push(
			item("Download", "download", () => {
				downloadEpisodeWithNotice(episode, get(settings).download.path).catch((error) =>
					console.error("PodNotes: download failed", error),
				);
			}),
		);
	}
	entries.push(
		item(favorite ? "Remove from Favorites" : "Add to Favorites", "heart", () =>
			actions.setFavorite(episode, !favorite),
		),
		{
			title: "Add to playlist",
			icon: "list-music",
			disabled: lists.length === 0,
			onClick: () =>
				showMenu(
					lists.map(({ name, icon, episodes }) => {
						const member = episodes.some((entry) =>
							isSameStoredEpisode(entry, episode),
						);
						return {
							title: name,
							icon,
							checked: member,
							onClick: () => actions.setInPlaylist(name, episode, !member),
						};
					}),
					at,
				),
		},
		"separator",
	);
	if (place !== "player") entries.push(markPlayed);
	if (link) {
		entries.push(
			item("Copy episode link", "link", () => {
				navigator.clipboard.writeText(link).then(
					() => new Notice("Episode link copied"),
					() => new Notice("Could not copy the episode link"),
				);
			}),
		);
	}
	return entries;
}

export function podcastMenu(key: FeedKey, services: ShellServices): MenuEntry[] {
	const { library, feeds, actions, navigation } = services;
	const feed = get(library.savedFeeds)[key];
	if (!feed) return [];
	const note = getFeedNote(feed);
	return [
		note
			? { title: "Open podcast note", icon: "file-text", onClick: () => openFeedNote(feed) }
			: {
					title: "Create podcast note",
					icon: "file-plus",
					onClick: () => void createFeedNote(feed),
				},
		...(get(feeds).get(key)?.error === "unavailable"
			? [
					{
						title: "Set feed address",
						icon: "rss",
						onClick: () => void actions.setFeedAddress(key),
					} as const,
				]
			: []),
		"separator",
		{
			title: "Remove podcast",
			icon: "trash",
			warning: true,
			onClick: () => {
				// Removing the open podcast first goes to the Library, so nothing shows a podcast that is gone.
				const { page } = navigation.current;
				if (page.kind === "feed" && page.key === key) navigation.goRoot("library");
				actions.removePodcast(key);
			},
		},
	];
}
