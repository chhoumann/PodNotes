import { type App, Notice } from "obsidian";
import { plugin, savedFeeds } from "./store";
import {
	internPrivateFeed,
	isSavedFeed,
	needsPrivateFeedAddress,
	resolveFeedUrl,
	setPrivateFeedAddress,
} from "./services/privateFeeds";
import { isCredentialBearingUrl } from "./utility/privateFeedUrl";
import type { PodcastFeed } from "./types/PodcastFeed";
import { TimerNotice } from "./ui/TimerNotice";
import { get } from "svelte/store";

/**
 * Read an attribute by name regardless of its casing. OPML in the wild is
 * inconsistent about the `xmlUrl` attribute (xmlurl, XmlUrl, xmlURL, ...), so a
 * fixed-case `getAttribute("xmlUrl")` silently drops otherwise-valid feeds.
 * Returns the trimmed value, or null when absent/empty.
 */
function getAttributeCaseInsensitive(node: Element, name: string): string | null {
	const target = name.toLowerCase();
	const attr = Array.from(node.attributes).find((attr) => attr.name.toLowerCase() === target);
	return attr?.value.trim() || null;
}

async function importOPML(opml: string): Promise<void> {
	try {
		const dp = new DOMParser();
		const dom = dp.parseFromString(opml, "application/xml");

		// DOMParser reports a malformed document by injecting a <parsererror>
		// element rather than throwing. The previous root-nodeName check only
		// worked in jsdom; Chromium (Obsidian's runtime) nests parsererror under
		// the document body, so querySelector is the engine-agnostic detection.
		if (dom.querySelector("parsererror")) {
			throw new Error("Invalid XML format");
		}

		// Select on the always-lowercase tag and the camelCase-safe `text` attr;
		// the xmlUrl attribute is read case-insensitively below so feeds written
		// with a lowercase/variant casing (e.g. `xmlurl`) aren't silently dropped.
		const incompletePodcastsToAdd: Pick<PodcastFeed, "title" | "url">[] = [];
		for (const node of Array.from(dom.querySelectorAll("outline[text]"))) {
			const title = node.getAttribute("text");
			const url = getAttributeCaseInsensitive(node, "xmlUrl");
			if (title && url) incompletePodcastsToAdd.push({ title, url });
		}

		if (incompletePodcastsToAdd.length === 0) {
			throw new Error("No valid podcast entries found in OPML");
		}

		const savedAtStart = get(savedFeeds);
		const existingSavedFeeds = Object.values(savedAtStart);
		const { feeds, feedUrls } = get(plugin);
		const newPodcastsToAdd = incompletePodcastsToAdd.filter(
			(pod) => !existingSavedFeeds.some((saved) => isSavedFeed(saved, pod.url, feedUrls)),
		);

		const notice = TimerNotice("Importing podcasts", "Preparing to import...");
		let completedImports = 0;

		const updateProgress = () => {
			const total = newPodcastsToAdd.length;
			// When every imported feed is already subscribed there is nothing to
			// fetch, so guard the 0/0 division that would otherwise render as
			// "NaN%" in the progress notice.
			if (total === 0) {
				notice.update("No new podcasts to import.");
				return;
			}
			notice.update(
				total === 1
					? "Importing 1 podcast..."
					: `Importing ${total} podcasts: ${completedImports} done.`,
			);
		};

		updateProgress();

		const podcasts: (PodcastFeed | null)[] = await Promise.all(
			newPodcastsToAdd.map(async (feed) => {
				try {
					return await feeds.channelAt({ url: feed.url });
				} catch (error) {
					console.error(`Failed to fetch feed for ${feed.title}: ${error}`);
					return null;
				} finally {
					completedImports++;
					updateProgress();
				}
			}),
		);

		notice.stop();

		const validPodcasts = podcasts.filter((pod): pod is PodcastFeed => pod !== null);

		// The store is keyed by title, so feeds whose title already exists (either
		// from an earlier import in this batch or a previously saved feed) are
		// dropped. Count what is actually written so the summary doesn't over-report.
		let savedCount = 0;
		const notStored: string[] = [];
		savedFeeds.update((saved) => {
			for (const pod of validPodcasts) {
				try {
					const existing = Object.prototype.hasOwnProperty.call(saved, pod.title)
						? saved[pod.title]
						: undefined;
					if (existing) {
						if (
							!needsPrivateFeedAddress(existing, feedUrls) ||
							!isCredentialBearingUrl(pod.url) ||
							savedAtStart[pod.title]?.urlSecretId !== existing.urlSecretId
						) {
							continue;
						}
						setPrivateFeedAddress(existing, pod.url, feedUrls);
					} else {
						// Imported private URLs go straight to SecretStorage, never data.json.
						saved[pod.title] = internPrivateFeed(structuredClone(pod), feedUrls);
					}
					savedCount++;
				} catch (error) {
					console.error(
						`PodNotes: could not store the private feed "${pod.title}"`,
						error,
					);
					notStored.push(pod.title);
				}
			}
			return saved;
		});

		// Feeds skipped before fetching because their URL was already subscribed.
		const skippedExisting = incompletePodcastsToAdd.length - newPodcastsToAdd.length;
		// Feeds that fetched fine but collided with an existing/earlier title and
		// were therefore silently dropped by the title-keyed store above.
		const droppedDuplicateTitle = validPodcasts.length - savedCount - notStored.length;

		let summary = `OPML import complete. Saved ${savedCount} ${savedCount === 1 ? "podcast" : "podcasts"}. Skipped ${skippedExisting} existing ${skippedExisting === 1 ? "podcast" : "podcasts"}.`;
		if (droppedDuplicateTitle > 0) {
			summary += ` Skipped ${droppedDuplicateTitle} with duplicate titles.`;
		}
		notice.update(summary);

		if (notStored.length > 0) {
			new Notice(
				`Could not store the private feed ${notStored.length === 1 ? "address" : "addresses"} for ${notStored.join(", ")} on this device.`,
				10000,
			);
		}

		if (validPodcasts.length !== newPodcastsToAdd.length) {
			const failedImports = newPodcastsToAdd.length - validPodcasts.length;
			console.error(`Failed to import ${failedImports} podcasts.`);
			new Notice(`Failed to import ${failedImports} podcasts.`, 10000);
		}

		window.setTimeout(() => notice.dispose(), 5000);
	} catch (error) {
		console.error("Error importing OPML:", error);
		new Notice(
			`Error importing OPML: ${error instanceof Error ? error.message : "Unknown error"}`,
			10000,
		);
	}
}

async function exportOPML(app: App, feeds: PodcastFeed[], filePath = "PodNotes_Export.opml") {
	// Escape every interpolated attribute value so titles/URLs containing &, <,
	// >, or " produce well-formed XML that round-trips back through importOPML.
	// `&` must run first so the entities written by the later replaces are not
	// themselves re-escaped.
	const escAttr = (s: string) =>
		s
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;");
	// An OPML export is a deliberate, user-initiated portability action, so a
	// private feed exports its REAL url (an export with placeholders is useless).
	// A private URL that cannot be resolved on this device exports as an empty
	// xmlUrl rather than a placeholder.
	let exportedPrivateFeeds = 0;
	const feedOutline = (feed: PodcastFeed) => {
		const url = resolveFeedUrl(feed, get(plugin).feedUrls) ?? "";
		if (feed.urlSecretId && url) exportedPrivateFeeds += 1;
		return `<outline text="${escAttr(feed.title)}" type="rss" xmlUrl="${escAttr(url)}" />`;
	};
	const doc = `<?xml version="1.0" encoding="utf-8" standalone="no"?><opml version="1.0"><head><title>PodNotes Feeds</title></head>
<body><outline text="feeds">${feeds.map(feedOutline).join("")}</outline></body></opml>`;

	try {
		await app.vault.create(filePath, doc);

		new Notice(`Exported ${feeds.length} podcast feeds to file "${filePath}".`);
		if (exportedPrivateFeeds > 0) {
			new Notice(
				`The export contains ${exportedPrivateFeeds} private feed ${exportedPrivateFeeds === 1 ? "URL" : "URLs"} in plaintext. The file is inside your vault - delete it after importing it elsewhere.`,
				10000,
			);
		}
	} catch (error) {
		new Notice(
			`Unable to create podcast export file:\n\n${error instanceof Error ? error.message : "Unknown error"}`,
		);
		console.error(error);
	}
}

export { importOPML, exportOPML };
