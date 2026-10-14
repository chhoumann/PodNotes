import { Menu, Notice } from "obsidian";
import { get } from "svelte/store";
import createFeedNote, { getFeedNote, openFeedNote } from "src/createFeedNote";
import createPodcastNote, { openPodcastNote } from "src/createPodcastNote";
import downloadEpisodeWithNotice, { removeDownloadedEpisode } from "src/downloadEpisode";
import { downloadedCopy } from "src/player/source";
import type { FeedKey } from "src/services/FeedRepository";
import { publicFeedUrl } from "src/services/privateFeeds";
import type { Episode } from "src/types/Episode";
import type { IconType } from "src/types/IconType";
import buildEpisodeResumeLink from "src/utility/buildEpisodeResumeLink";
import { isSameEpisode, isSameStoredEpisode } from "src/utility/episodeKey";
import { episodeLinkTarget } from "src/utility/episodeLinkTarget";
import { isEpisodeFinished } from "src/utility/episodeStatus";
import { isLocalFile } from "src/utility/isLocalFile";
import { PLAYBACK_RATES } from "src/utility/playbackRate";
import { isCredentialBearingUrl } from "src/utility/privateFeedUrl";
import type { ShellServices } from "./context";
import { availabilityOf, isCurrentEpisode } from "./episodeRow";

/** A menu item, or a separator. Menus are built as data, so tests read them as data. */
export type MenuEntry =
	| {
			readonly title: string;
			readonly icon?: IconType;
			readonly checked?: boolean;
			readonly warning?: boolean;
			readonly disabled?: boolean;
			onClick(): void;
	  }
	| "separator";

/**
 * Where a menu opens, and the control that opened it. The document is the one the
 * pointer was in, which can be a popout's.
 */
export interface MenuAnchor {
	readonly x: number;
	readonly y: number;
	readonly doc: Document;
	readonly el: HTMLElement;
}

/** A right-click or long press opens the menu at the pointer, a button under itself. */
export function anchorOf(event: MouseEvent): MenuAnchor {
	const el = event.currentTarget as HTMLElement;
	if (event.type === "contextmenu") {
		event.preventDefault();
		return { x: event.clientX, y: event.clientY, doc: el.doc, el };
	}
	const { left, bottom } = el.getBoundingClientRect();
	return { x: left, y: bottom, doc: el.doc, el };
}

/**
 * Focus goes back to the control that opened the menu, so the next Escape reaches
 * the view. A picked item runs after that, so one that opens a note or a modal
 * keeps the focus it sets. Obsidian runs an item before it hides the menu.
 */
export function showMenu(entries: readonly MenuEntry[], at: MenuAnchor): void {
	let picked = false;
	const menu = new (class extends Menu {
		// Obsidian's menu passes on the Escape that closes it, and Obsidian sends focus from a
		// sidebar to the main area on an Escape nothing handled. This one counts as handled.
		// On a phone the menu hides after a 150 ms animation, when the event is long gone, so
		// this runs as the hide starts, inside that keydown.
		override hide() {
			const closing = at.el.win.event;
			if (closing?.type === "keydown" && "key" in closing && closing.key === "Escape")
				closing.preventDefault();
			if (!picked && at.el.isConnected) at.el.focus();
			return super.hide();
		}
	})();
	for (const entry of entries) {
		if (entry === "separator") {
			menu.addSeparator();
			continue;
		}
		menu.addItem((item) => {
			item.setTitle(entry.title).onClick(() => {
				picked = true;
				at.el.focus();
				entry.onClick();
			});
			if (entry.icon) item.setIcon(entry.icon);
			if (entry.checked) item.setChecked(true);
			if (entry.warning) item.setWarning(true);
			if (entry.disabled) item.setDisabled(true);
		});
	}
	menu.showAtPosition(at, at.doc);
}

/** The rate pill's speeds. The live rate, which the commands step by 0.1, may be none of them. */
export function rateMenu({ player }: ShellServices): MenuEntry[] {
	const live = get(player.state).playbackRate;
	return PLAYBACK_RATES.map((rate) => ({
		title: `${rate}×`,
		checked: rate === live,
		onClick: () => player.setPlaybackRate(rate),
	}));
}

/** Open note, or Create note from the template, which opens it. */
export function noteEntry(
	episode: Episode,
	{ hasNote, settings }: ShellServices,
): { readonly title: string; readonly icon: IconType; onClick(): void } {
	return hasNote(episode)
		? { title: "Open note", icon: "file-text", onClick: () => openPodcastNote(episode) }
		: {
				title: "Create note",
				icon: "file-plus",
				onClick: () => {
					const { path, template } = get(settings).note;
					if (path && template) void createPodcastNote(episode);
					else new Notice("Please set a note path and template in the settings.");
				},
			};
}

function copy(text: string, what: string): void {
	navigator.clipboard.writeText(text).then(
		() => new Notice(`${what.charAt(0).toUpperCase()}${what.slice(1)} copied`),
		() => new Notice(`Could not copy the ${what}`),
	);
}

/**
 * The one way the view starts an episode. One it cannot play is refused before
 * `player.play`, which would queue the episode playing now and then fail.
 */
export function openEpisode(
	{ player, navigation, library, online }: ShellServices,
	episode: Episode,
	resolved = true,
) {
	const availability = availabilityOf(
		episode,
		resolved,
		get(online),
		get(library.downloadedEpisodes),
	);
	if (availability === "missing") {
		new Notice("This played episode is no longer available in current feeds.");
		return;
	}
	if (!isCurrentEpisode(get(player.state).episode, episode)) {
		if (availability === "not-downloaded") {
			new Notice("Not downloaded");
			return;
		}
		player.play(episode);
	}
	navigation.expand();
}

export interface EpisodeMenuOptions {
	/** player: the full player's own episode, which has no Play. */
	readonly place: "list" | "player";
	readonly at: MenuAnchor;
	/** False for a Played record that matched no episode. */
	readonly resolved?: boolean;
	/** A Played record stored under another key than the episode's. */
	readonly playedKey?: string;
}

export function episodeMenu(
	episode: Episode,
	services: ShellServices,
	{ place, at, resolved = true, playedKey }: EpisodeMenuOptions,
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
	if (!resolved) return [markPlayed];

	const queued = get(library.queue).episodes.some((entry) => isSameEpisode(entry, episode));
	const favorite = get(library.favorites).episodes.some((entry) =>
		isSameStoredEpisode(entry, episode),
	);
	const downloaded = downloadedCopy(get(library.downloadedEpisodes), episode) !== undefined;
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
	entries.push("separator", noteEntry(episode, services));
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
			// Obsidian's menus have no submenu, so the playlists open as a menu of their own.
			onClick: () => {
				const lists = Object.values(get(library.playlists)).map(
					({ name, icon, episodes }): MenuEntry => {
						const member = episodes.some((entry) =>
							isSameStoredEpisode(entry, episode),
						);
						return {
							title: name,
							icon,
							checked: member,
							onClick: () => actions.setInPlaylist(name, episode, !member),
						};
					},
				);
				showMenu(
					[
						...lists,
						...(lists.length ? ["separator" as const] : []),
						item("New playlist", "plus", () => void actions.createPlaylist(episode)),
					],
					at,
				);
			},
		},
		"separator",
	);
	if (place !== "player") entries.push(markPlayed);
	if (link) {
		entries.push(item("Copy episode link", "link", () => copy(link, "episode link")));
	}
	return entries;
}

export function podcastMenu(key: FeedKey, services: ShellServices): MenuEntry[] {
	const { library, feeds, actions, navigation, online } = services;
	const feed = get(library.savedFeeds)[key];
	if (!feed) return [];
	const note = getFeedNote(feed);
	const error = get(feeds).get(key)?.error;
	const isPublic = publicFeedUrl(feed) !== undefined;
	// An address is checked by loading its feed.
	const address = (title: string): MenuEntry => ({
		title,
		icon: "rss",
		disabled: !get(online),
		onClick: () => void actions.setFeedAddress(key),
	});
	return [
		note
			? { title: "Open podcast note", icon: "file-text", onClick: () => openFeedNote(feed) }
			: {
					title: "Create podcast note",
					icon: "file-plus",
					onClick: () => void createFeedNote(feed),
				},
		...(isPublic
			? [
					{
						title: "Copy feed URL",
						icon: "link",
						onClick: () => {
							const url = publicFeedUrl(get(library.savedFeeds)[key] ?? feed);
							if (url) copy(url, "feed URL");
						},
					} as const,
				]
			: []),
		...(error === "unavailable"
			? [address("Set feed address")]
			: isPublic && error === "network"
				? [address("Edit feed URL")]
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

/** The Queue page's options. The preference item asks for the opposite of what its menu showed. */
export function queueMenu({
	library,
	actions,
	settings,
	setAutoQueue,
}: ShellServices): MenuEntry[] {
	const auto = get(settings).autoQueue;
	return [
		{
			title: "Queue episodes I switch away from",
			icon: "list-end",
			checked: auto,
			onClick: () => setAutoQueue(!auto),
		},
		"separator",
		{
			title: "Clear queue",
			icon: "trash",
			warning: true,
			disabled: get(library.queue).episodes.length === 0,
			onClick: () => actions.clearQueue(),
		},
	];
}

/** A playlist of the user's. Deleting the open one goes to Playlists first, which stays. */
export function playlistMenu(name: string, { actions, navigation }: ShellServices): MenuEntry[] {
	return [
		{
			title: "Delete playlist",
			icon: "trash",
			warning: true,
			onClick: () => {
				const { page } = navigation.current;
				if (page.kind === "playlist" && page.name === name) navigation.goRoot("playlists");
				actions.deletePlaylist(name);
			},
		},
	];
}
